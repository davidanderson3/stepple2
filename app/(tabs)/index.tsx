import { useEffect, useState } from 'react';
import { StyleSheet, Button, Text } from 'react-native';
import { View } from '@/components/Themed';
import GoogleFit, { Scopes } from 'react-native-google-fit';

export default function TabOneScreen() {
  const [steps, setSteps] = useState<number | null>(null);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const options = {
      scopes: [Scopes.FITNESS_ACTIVITY_READ],
    };

    GoogleFit.checkIsAuthorized()
      .then((isAuthorized) => {
        if (!isAuthorized) {
          return GoogleFit.authorize(options)
            .then((authResult) => {
              if (authResult.success) {
                setAuthorized(true);
                fetchSteps();
              } else {
                console.warn('AUTH FAIL', authResult);
              }
            });
        } else {
          setAuthorized(true);
          fetchSteps();
        }
      })
      .catch((err) => {
        console.error('AUTH CHECK ERROR', err);
      });
  }, []);

  const fetchSteps = () => {
    const today = new Date();
    const options = {
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString(),
      endDate: today.toISOString(),
    };

    GoogleFit.getDailyStepCountSamples(options)
      .then((results) => {
        const stepsToday =
          results.find((r) => r.source === 'com.google.android.gms.fit')?.steps?.[0]?.value || 0;
        setSteps(stepsToday);
      })
      .catch((err) => {
        console.error('STEPS ERROR', err);
      });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Steps Today</Text>
      <Text style={styles.stepCount}>{steps !== null ? steps : 'Loading...'}</Text>
      {!authorized && (
        <Button
          title="Authorize Google Fit"
          onPress={() => {
            GoogleFit.authorize({
              scopes: [
                Scopes.FITNESS_ACTIVITY_READ,
                Scopes.FITNESS_ACTIVITY_WRITE,
                Scopes.FITNESS_LOCATION_READ,
              ],
            })
              .then((authResult) => {
                if (authResult.success) {
                  setAuthorized(true);
                  fetchSteps();
                } else {
                  console.warn('AUTH FAIL', authResult);
                }
              })
              .catch((error) => {
                console.error('AUTH ERROR', error);
              });
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  stepCount: {
    fontSize: 48,
    fontWeight: '600',
  },
});
