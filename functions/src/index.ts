import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { firestore } from 'firebase-admin';
import fetch from 'cross-fetch';
import { google } from 'googleapis';

admin.initializeApp();
const db = admin.firestore();

const GOOGLE_FIT_SCOPE = 'https://www.googleapis.com/auth/fitness.activity.read';

const getOAuthCredentials = () => {
  const clientId = functions.config().googlefit?.client_id as string | undefined;
  const clientSecret = functions.config().googlefit?.client_secret as string | undefined;

  if (!clientId || !clientSecret) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Google Fit client credentials are not configured. Run `firebase functions:config:set googlefit.client_id="CLIENT_ID" googlefit.client_secret="CLIENT_SECRET"`.',
    );
  }

  return { clientId, clientSecret };
};

export const linkGoogleFit = functions
  .region('us-central1')
  .https.onCall(async (data: any, context: functions.https.CallableContext) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication is required.');
    }

    const authCode = (data?.authCode as string | undefined)?.trim();
    const redirectUri = (data?.redirectUri as string | undefined)?.trim();

    if (!authCode || !redirectUri) {
      throw new functions.https.HttpsError('invalid-argument', 'authCode and redirectUri are required.');
    }

    const { clientId, clientSecret } = getOAuthCredentials();

    const params = new URLSearchParams({
      code: authCode,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const tokenPayload = await tokenResponse.json();

    if (!tokenResponse.ok) {
      functions.logger.error('Failed to exchange Google Fit auth code', tokenPayload);
      throw new functions.https.HttpsError('internal', 'Failed to exchange authorization code.');
    }

    const integrationRef = db.doc(`users/${context.auth.uid}/integrations/googleFit`);
    const updatePayload: admin.firestore.UpdateData<admin.firestore.DocumentData> = {
      provider: 'googleFit',
      scope: tokenPayload.scope ?? GOOGLE_FIT_SCOPE,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (tokenPayload.refresh_token) {
      updatePayload.refreshToken = tokenPayload.refresh_token;
    }

    if (tokenPayload.access_token) {
      updatePayload.accessToken = tokenPayload.access_token;
    }

    if (tokenPayload.expires_in) {
      updatePayload.accessTokenExpiry = admin.firestore.Timestamp.fromMillis(
        Date.now() + tokenPayload.expires_in * 1000,
      );
    }

    await integrationRef.set(updatePayload, { merge: true });

    return {
      success: true,
      hasRefreshToken: Boolean(tokenPayload.refresh_token),
    };
  });

const sumBucketSteps = (bucket: any): number => {
  if (!bucket?.dataset?.length) {
    return 0;
  }
  return bucket.dataset.reduce((bucketTotal: number, dataset: any) => {
    if (!dataset.point?.length) {
      return bucketTotal;
    }
    const datasetTotal = dataset.point.reduce((pointTotal: number, point: any) => {
      if (!point.value?.length) {
        return pointTotal;
      }
      const value = point.value[0];
      const count = value?.intVal ?? value?.fpVal ?? 0;
      return pointTotal + (typeof count === 'number' ? count : 0);
    }, 0);
    return bucketTotal + datasetTotal;
  }, 0);
};

export const syncGoogleFitSteps = functions
  .region('us-central1')
  .pubsub.schedule('every 30 minutes')
  .onRun(async () => {
    const { clientId, clientSecret } = getOAuthCredentials();

    const integrationsSnapshot = await db
      .collectionGroup('integrations')
      .where('provider', '==', 'googleFit')
      .get();

    if (integrationsSnapshot.empty) {
      functions.logger.info('No Google Fit integrations found.');
      return null;
    }

    const now = Date.now();
    const startMillis = now - 3 * 24 * 60 * 60 * 1000; // last 3 days

    const bucketsDuration = 24 * 60 * 60 * 1000;

    await Promise.all(
      integrationsSnapshot.docs.map(async (integrationDoc: firestore.QueryDocumentSnapshot<firestore.DocumentData>) => {
        const integrationData = integrationDoc.data() as {
          refreshToken?: string;
          accessToken?: string;
        };
        const refreshToken = integrationData.refreshToken as string | undefined;
        if (!refreshToken) {
          functions.logger.warn('Missing refresh token for integration', integrationDoc.ref.path);
          return;
        }

        const userRef = integrationDoc.ref.parent?.parent;
        if (!userRef) {
          functions.logger.warn('Unable to resolve user reference for integration', integrationDoc.ref.path);
          return;
        }

        const uid = userRef.id;

        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({
          refresh_token: refreshToken,
          access_token: integrationData.accessToken,
        });

        const fitness = google.fitness({ version: 'v1', auth: oauth2Client });

        try {
          const aggregateResponse: any = await fitness.users.dataset.aggregate({
            userId: 'me',
            requestBody: {
              aggregateBy: [
                {
                  dataTypeName: 'com.google.step_count.delta',
                },
              ],
              bucketByTime: {
                durationMillis: bucketsDuration,
              },
              startTimeMillis: startMillis,
              endTimeMillis: now,
            },
          } as any);

          const buckets = aggregateResponse?.data?.bucket ?? [];
          if (!buckets.length) {
            functions.logger.info('No buckets returned for user', uid);
            return;
          }

          const batch = db.batch();

          buckets.forEach((bucket: any) => {
            const bucketStartMillis = bucket.startTimeMillis
              ? Number(bucket.startTimeMillis)
              : bucket.startTimeNanos
                ? Number(bucket.startTimeNanos) / 1_000_000
                : undefined;
            if (!bucketStartMillis) {
              return;
            }
            const stepCount = sumBucketSteps(bucket);
            const date = new Date(bucketStartMillis);
            const dateId = date.toISOString().split('T')[0];
            const stepDocRef = userRef.collection('steps').doc(dateId);
            batch.set(
              stepDocRef,
              {
                count: stepCount,
                provider: 'googleFit',
                lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
            batch.set(
              userRef,
              {
                lastStepCount: stepCount,
                lastUpdatedDate: dateId,
                cloudSyncProvider: 'googleFit',
                cloudSyncUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          });

          await batch.commit();
        } catch (error) {
          functions.logger.error('Failed to sync Google Fit steps', uid, error);
        }
      }),
    );

    return null;
  });
