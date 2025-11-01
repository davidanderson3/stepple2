import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TextInput, Button, Alert, Share, Linking, Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../firebaseConfig';
import { Text, View } from '@/components/Themed';
import { generateUserId } from '../../lib/generateUserId';
import HealthConnect, { HealthConnectStatus } from '../../modules/healthConnect';

export default function TabTwoScreen() {
  const [userName, setUserName] = useState('');
  const [inputName, setInputName] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [linkingHealthConnect, setLinkingHealthConnect] = useState(false);
  const [healthSdkStatus, setHealthSdkStatus] = useState<number | null>(null);
  const [hasHealthPermissions, setHasHealthPermissions] = useState(false);
  const [healthMessage, setHealthMessage] = useState<string | null>(null);

  const hydrateProfile = useCallback(async (id: string) => {
    try {
      const profileRef = doc(db, 'users', id);
      const profileSnap = await getDoc(profileRef);
      if (profileSnap.exists()) {
        const data = profileSnap.data() as { name?: string };
        if (data.name) {
          setUserName(data.name);
          setInputName(data.name);
        }
      }
    } catch (error) {
      console.warn('Failed to load profile from Firestore', error);
    }
  }, []);

  const upsertProfile = useCallback(async (id: string, name?: string | null) => {
    try {
      await setDoc(
        doc(db, 'users', id),
        {
          userId: id,
          name: name ?? '',
          inviteCode: id,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      console.warn('Failed to persist profile', error);
    }
  }, []);

  const ensureUserId = useCallback(async () => {
    const storedId = await AsyncStorage.getItem('userId');
    if (storedId) {
      setUserId(storedId);
      await hydrateProfile(storedId);
      return storedId;
    }
    const newId = generateUserId();
    await AsyncStorage.setItem('userId', newId);
    setUserId(newId);
    await upsertProfile(newId, inputName || userName);
    return newId;
  }, [hydrateProfile, inputName, upsertProfile, userName]);

  useEffect(() => {
    const load = async () => {
      await ensureUserId();
      await ensureSignedIn();
    };
    load().catch(console.error);
  }, [ensureUserId]);

  const markIntegration = useCallback(async (id: string) => {
    try {
      await setDoc(
        doc(db, 'users', id, 'integrations', 'healthConnect'),
        {
          provider: 'healthConnect',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      console.warn('Failed to persist Health Connect integration metadata', error);
    }
  }, []);

  const refreshHealthConnectStatus = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setHealthSdkStatus(null);
      setHasHealthPermissions(false);
      setHealthMessage('Health Connect is only available on Android devices.');
      return;
    }

    const status = await HealthConnect.getSdkStatus();
    setHealthSdkStatus(status);

    switch (status) {
      case HealthConnectStatus.SDK_AVAILABLE: {
        const granted = await HealthConnect.hasPermissions();
        setHasHealthPermissions(granted);
        setHealthMessage(granted ? null : 'Enable Health Connect below to sync your steps.');
        if (granted && userId) {
          await markIntegration(userId);
        }
        break;
      }
      case HealthConnectStatus.SDK_UNAVAILABLE: {
        setHasHealthPermissions(false);
        setHealthMessage('Health Connect is unavailable right now. Install or update the Health Connect app and try again.');
        break;
      }
      case HealthConnectStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: {
        setHasHealthPermissions(false);
        setHealthMessage('Install or update Health Connect from Google Play, then come back to Stepple.');
        break;
      }
      case HealthConnectStatus.SDK_UNAVAILABLE_DEVICE_NOT_SUPPORTED: {
        setHasHealthPermissions(false);
        setHealthMessage('Turn on “Allow access to Health Connect data” in the Health Connect app so Stepple can sync your steps.');
        break;
      }
      default: {
        setHasHealthPermissions(false);
        setHealthMessage(`Health Connect returned status code ${status}. Try installing/updating the Health Connect app.`);
        break;
      }
    }
  }, [markIntegration, userId]);

  useEffect(() => {
    refreshHealthConnectStatus().catch(console.error);
  }, [refreshHealthConnectStatus]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        refreshHealthConnectStatus().catch(console.error);
      }
    });
    return () => subscription.remove();
  }, [refreshHealthConnectStatus]);

  const handleSaveName = async () => {
    if (inputName.trim()) {
      const trimmed = inputName.trim();
      await AsyncStorage.setItem('userName', trimmed);
      setUserName(trimmed);
      if (userId) {
        await upsertProfile(userId, trimmed);
      }
      Alert.alert('Success', 'Your name has been updated.');
    } else {
      Alert.alert('Error', 'Name cannot be empty.');
    }
  };

  const handleEnableHealthConnect = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('Health Connect', 'Health Connect is only available on Android devices.');
      return;
    }

    setLinkingHealthConnect(true);
    try {
      const status = await HealthConnect.getSdkStatus();
      if (status === HealthConnectStatus.SDK_AVAILABLE) {
        const granted = await HealthConnect.requestPermissions();
        if (!granted) {
          Alert.alert('Health Connect', 'Permissions were not granted.');
        }
      } else if (status === HealthConnectStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED || status === HealthConnectStatus.SDK_UNAVAILABLE) {
        openHealthConnectInPlayStore();
      } else if (status === HealthConnectStatus.SDK_UNAVAILABLE_DEVICE_NOT_SUPPORTED) {
        await HealthConnect.openSettings();
        Alert.alert('Health Connect', 'Enable “Allow access to Health Connect data,” then return to Stepple.');
      } else {
        Alert.alert('Health Connect', `Health Connect returned status code ${status}.`);
      }
    } catch (error: any) {
      console.warn('Failed to request Health Connect permissions', error);
      if (error?.code === 'HC_SETTINGS') {
        Alert.alert('Health Connect', 'Unable to open Health Connect settings. Please open the Health Connect app manually.');
      } else if (error?.code === 'HC_PROVIDER_UPDATE_REQUIRED') {
        Alert.alert('Install Health Connect', 'Install or update Health Connect from Google Play, then try again.');
      } else if (error?.code === 'HC_DEVICE_NOT_SUPPORTED') {
        Alert.alert('Health Connect', 'This device does not support Health Connect.');
      } else {
        Alert.alert('Health Connect', error?.message ?? 'Unable to request permissions.');
      }
    } finally {
      setLinkingHealthConnect(false);
      refreshHealthConnectStatus().catch(console.error);
    }
  };

  const openHealthConnectInPlayStore = () => {
    const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';
    Linking.openURL(playStoreUrl).catch(console.error);
  };

  const onInvite = async () => {
    const id = userId ?? (await ensureUserId());
    if (!id) {
      Alert.alert('Error', 'Could not generate invite link. Please try again.');
      return;
    }
    try {
      const deepLink = `stepple://add-friend/${id}`;
      await Share.share({
        message: `Join me on Stepple! Click this link to add me to your leaderboard: ${deepLink}`,
      });
    } catch (error: any) {
      Alert.alert(error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Profile</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Current Name:</Text>
        <Text style={styles.name}>{userName || 'Not set'}</Text>
        <Text style={styles.label}>Edit Name:</Text>
        <TextInput
          style={styles.input}
          value={inputName}
          onChangeText={setInputName}
          placeholder="Enter your new name"
        />
        <Button title="Save Name" onPress={handleSaveName} />
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Share Stepple</Text>
        <Button title="Invite a Friend" onPress={onInvite} />
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Health Connect</Text>
        {healthMessage && <Text style={styles.metaText}>{healthMessage}</Text>}
        <Button
          title={hasHealthPermissions ? 'Health Connect Enabled' : 'Enable Health Connect'}
          onPress={hasHealthPermissions ? undefined : handleEnableHealthConnect}
          disabled={linkingHealthConnect || hasHealthPermissions}
        />
        {healthSdkStatus !== null && healthSdkStatus !== HealthConnectStatus.SDK_AVAILABLE && (
          <Button title="Install / Update Health Connect" onPress={openHealthConnectInPlayStore} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    marginBottom: 20,
    padding: 20,
    width: '100%',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  name: {
    fontSize: 18,
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    marginBottom: 20,
    backgroundColor: 'white',
  },
  metaText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 12,
  },
});
