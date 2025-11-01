"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncGoogleFitSteps = exports.linkGoogleFit = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const cross_fetch_1 = __importDefault(require("cross-fetch"));
const googleapis_1 = require("googleapis");
admin.initializeApp();
const db = admin.firestore();
const GOOGLE_FIT_SCOPE = 'https://www.googleapis.com/auth/fitness.activity.read';
const getOAuthCredentials = () => {
    const clientId = functions.config().googlefit?.client_id;
    const clientSecret = functions.config().googlefit?.client_secret;
    if (!clientId || !clientSecret) {
        throw new functions.https.HttpsError('failed-precondition', 'Google Fit client credentials are not configured. Run `firebase functions:config:set googlefit.client_id="CLIENT_ID" googlefit.client_secret="CLIENT_SECRET"`.');
    }
    return { clientId, clientSecret };
};
exports.linkGoogleFit = functions
    .region('us-central1')
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication is required.');
    }
    const authCode = data?.authCode?.trim();
    const redirectUri = data?.redirectUri?.trim();
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
    const tokenResponse = await (0, cross_fetch_1.default)('https://oauth2.googleapis.com/token', {
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
    const updatePayload = {
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
        updatePayload.accessTokenExpiry = admin.firestore.Timestamp.fromMillis(Date.now() + tokenPayload.expires_in * 1000);
    }
    await integrationRef.set(updatePayload, { merge: true });
    return {
        success: true,
        hasRefreshToken: Boolean(tokenPayload.refresh_token),
    };
});
const sumBucketSteps = (bucket) => {
    if (!bucket?.dataset?.length) {
        return 0;
    }
    return bucket.dataset.reduce((bucketTotal, dataset) => {
        if (!dataset.point?.length) {
            return bucketTotal;
        }
        const datasetTotal = dataset.point.reduce((pointTotal, point) => {
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
exports.syncGoogleFitSteps = functions
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
    await Promise.all(integrationsSnapshot.docs.map(async (integrationDoc) => {
        const integrationData = integrationDoc.data();
        const refreshToken = integrationData.refreshToken;
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
        const oauth2Client = new googleapis_1.google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({
            refresh_token: refreshToken,
            access_token: integrationData.accessToken,
        });
        const fitness = googleapis_1.google.fitness({ version: 'v1', auth: oauth2Client });
        try {
            const aggregateResponse = await fitness.users.dataset.aggregate({
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
            });
            const buckets = aggregateResponse?.data?.bucket ?? [];
            if (!buckets.length) {
                functions.logger.info('No buckets returned for user', uid);
                return;
            }
            const batch = db.batch();
            buckets.forEach((bucket) => {
                const bucketStartMillis = bucket.startTimeMillis
                    ? Number(bucket.startTimeMillis)
                    : bucket.startTimeNanos
                        ? Number(bucket.startTimeNanos) / 1000000
                        : undefined;
                if (!bucketStartMillis) {
                    return;
                }
                const stepCount = sumBucketSteps(bucket);
                const date = new Date(bucketStartMillis);
                const dateId = date.toISOString().split('T')[0];
                const stepDocRef = userRef.collection('steps').doc(dateId);
                batch.set(stepDocRef, {
                    count: stepCount,
                    provider: 'googleFit',
                    lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
                batch.set(userRef, {
                    lastStepCount: stepCount,
                    lastUpdatedDate: dateId,
                    cloudSyncProvider: 'googleFit',
                    cloudSyncUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            });
            await batch.commit();
        }
        catch (error) {
            functions.logger.error('Failed to sync Google Fit steps', uid, error);
        }
    }));
    return null;
});
