import { useEffect, useState } from 'react';
import { StyleSheet, Button, Text, PermissionsAndroid } from 'react-native';
import { View } from '@/components/Themed';
import GoogleFit, { Scopes } from 'react-native-google-fit';

export default function TabOneScreen() {
  const [steps, setSteps] = useState<number | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const authOptions = {
    scopes: [
      Scopes.FITNESS_ACTIVITY_READ,
      Scopes.FITNESS_ACTIVITY_WRITE,
      Scopes.FITNESS_LOCATION_READ,
    ],
  };

  const requestActivityPermission = async () => {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    );
    console.log('ACTIVITY_RECOGNITION permission result', result);

    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      setErrorMessage('Activity recognition permission denied');
      return false;
    }

    setErrorMessage(null);
    return true;
  };

  useEffect(() => {
    const init = async () => {
      const hasPermission = await requestActivityPermission();
      if (!hasPermission) {
        return;
      }

      console.log('Google Fit authorization options', authOptions);

      try {
        await GoogleFit.checkIsAuthorized();
        console.log('checkIsAuthorized ->', GoogleFit.isAuthorized);
        if (!GoogleFit.isAuthorized) {
          const authResult = await GoogleFit.authorize(authOptions);
          console.log('authorize() result', authResult);
          if (authResult.success) {
            setAuthorized(true);
            await fetchSteps();
          } else {
            console.warn('AUTH FAIL', authResult);
            setErrorMessage(`Authorization failed: ${authResult.message}`);
          }
        } else {
          setAuthorized(true);
          await fetchSteps();
        }
      } catch (err) {
        console.error('AUTH CHECK ERROR', err);
      }
    };

    init();
  }, []);

  const fetchSteps = async () => {
    const today = new Date();
    const options = {
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString(),
      endDate: today.toISOString(),
    };

    try {
      const results = await GoogleFit.getDailyStepCountSamples(options);
      const stepsToday =
        results.find((r) => r.source === 'com.google.android.gms.fit')?.steps?.[0]?.value || 0;
      setSteps(stepsToday);
    } catch (err) {
      console.error('STEPS ERROR', err);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Steps Today</Text>
      <Text style={styles.stepCount}>{steps !== null ? steps : 'Loading...'}</Text>
      {errorMessage && <Text>{errorMessage}</Text>}
      {!authorized && (
        <Button
          title="Authorize Google Fit"
          onPress={async () => {
            const hasPermission = await requestActivityPermission();
            if (!hasPermission) {
              return;
            }
            console.log('Manual authorize with options', authOptions);
            try {
              const authResult = await GoogleFit.authorize(authOptions);
              console.log('Manual authorize result', authResult);
              if (authResult.success) {
                setAuthorized(true);
                await fetchSteps();
              } else {
                console.warn('AUTH FAIL', authResult);
                setErrorMessage(`Authorization failed: ${authResult.message}`);
              }
            } catch (error) {
              console.error('AUTH ERROR', error);
            }
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
