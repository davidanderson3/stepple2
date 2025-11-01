import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Button, Text, Modal, TextInput, Pressable, Alert, Platform, AppState } from 'react-native';
import { View } from '@/components/Themed';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { db } from '../../firebaseConfig';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { generateUserId } from '../../lib/generateUserId';
import HealthConnect, { HealthConnectStatus } from '../../modules/healthConnect';

interface Friend {
  id: string;
  name: string;
  steps: number | null;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export default function TabOneScreen() {
  const [steps, setSteps] = useState<number | null>(null);
  const [healthStatus, setHealthStatus] = useState<number | null>(null);
  const [hasPermissions, setHasPermissions] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isNameModalVisible, setNameModalVisible] = useState(false);
  const [inputName, setInputName] = useState('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loadingDots, setLoadingDots] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendSteps, setFriendSteps] = useState<Record<string, number | null>>({});

  const getDateId = (date: Date) => date.toISOString().split('T')[0];
  const getCacheKey = (date: Date) => `steps-${getDateId(date)}`;

  const persistProfile = useCallback(async (id: string, name: string | null) => {
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
      console.warn('Failed to update profile document', error);
    }
  }, []);

  const ensureUserId = useCallback(async () => {
    const storedId = await AsyncStorage.getItem('userId');
    if (storedId) {
      setUserId(storedId);
      return storedId;
    }
    const newId = generateUserId();
    await AsyncStorage.setItem('userId', newId);
    setUserId(newId);
    await persistProfile(newId, userName);
    return newId;
  }, [persistProfile, userName]);

  const syncStepCount = useCallback(async (id: string, date: Date, value: number) => {
    try {
      const dateId = getDateId(date);
      await setDoc(
        doc(db, 'users', id, 'steps', dateId),
        {
          count: value,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await setDoc(
        doc(db, 'users', id),
        {
          lastUpdatedDate: dateId,
          lastStepCount: value,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      console.warn('Failed to sync step count', error);
    }
  }, []);

  useEffect(() => {
    const handleDeepLink = async (event: { url: string }) => {
      const { path, queryParams } = Linking.parse(event.url);
      console.log(`Linked to app with path: ${path} and data: ${JSON.stringify(queryParams)}`);

      const match = path?.match(/add-friend\/([^/]+)/);
      if (match) {
        const friendId = match[1];
        const friendsJson = await AsyncStorage.getItem('friendsList');
        const friendIds: string[] = friendsJson ? JSON.parse(friendsJson) : [];

        if (!friendIds.includes(friendId)) {
          const newFriendIds = [...friendIds, friendId];
          await AsyncStorage.setItem('friendsList', JSON.stringify(newFriendIds));
          const newFriend: Friend = { id: friendId, name: `Friend ${friendId.substring(0, 4)}`, steps: null };
          setFriends(currentFriends => [...currentFriends, newFriend]);
          Alert.alert('Friend Added!', `You've added a new friend to your leaderboard.`);
        } else {
          Alert.alert('Already Friends', 'This person is already on your leaderboard.');
        }
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink as any);
    Linking.getInitialURL()
      .then(initialUrl => {
        if (initialUrl) {
          handleDeepLink({ url: initialUrl });
        }
      })
      .catch(console.error);
    return () => subscription.remove();
  }, []);

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const fetchSteps = useCallback(
    async (date: Date, options: { forceRefetch?: boolean; skipDisplay?: boolean } = {}) => {
      if (Platform.OS !== 'android') {
        setErrorMessage('Health Connect is only available on Android devices.');
        return;
      }

      const { forceRefetch = false, skipDisplay = false } = options;
      const cacheKey = getCacheKey(date);
      const cachedSteps = await AsyncStorage.getItem(cacheKey);

      if (!skipDisplay) {
        setSteps(cachedSteps !== null ? parseInt(cachedSteps, 10) : null);
      }

      if (!isToday(date) && cachedSteps !== null && !forceRefetch) {
        return;
      }

      if (!hasPermissions) {
        if (!skipDisplay) {
          setErrorMessage('Enable Health Connect from the Settings tab to sync your steps.');
        }
        return;
      }

      try {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const end = start + DAY_IN_MS - 1;
        const stepCount = await HealthConnect.readSteps(start, end);
        if (!skipDisplay) {
          setSteps(stepCount);
        }
        await AsyncStorage.setItem(cacheKey, stepCount.toString());

        const id = userId ?? (await ensureUserId());
        if (id) {
          await syncStepCount(id, date, stepCount);
        }
        if (!skipDisplay) {
          setErrorMessage(null);
        }
      } catch (err) {
        console.error('STEPS ERROR', err);
        if (!skipDisplay) {
          setErrorMessage('Unable to read data from Health Connect.');
        }
      }
    },
    [ensureUserId, hasPermissions, isToday, syncStepCount, userId],
  );

  const cachePreviousDays = useCallback(async () => {
    console.log('Starting to cache previous days steps...');
    const today = new Date();
    for (let i = 1; i <= 30; i++) {
      const pastDate = new Date(today.getTime() - i * DAY_IN_MS);
      const cacheKey = getCacheKey(pastDate);
      const cachedSteps = await AsyncStorage.getItem(cacheKey);
      if (cachedSteps === null) {
        await fetchSteps(pastDate, { skipDisplay: true, forceRefetch: true });
      }
    }
  }, [fetchSteps]);

  const refreshHealthConnect = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setHealthStatus(null);
      setHasPermissions(false);
      setErrorMessage('Health Connect is only available on Android devices.');
      return;
    }

    const status = await HealthConnect.getSdkStatus();
    setHealthStatus(status);

    if (status === HealthConnectStatus.SDK_AVAILABLE) {
      const granted = await HealthConnect.hasPermissions();
      setHasPermissions(granted);
      setErrorMessage(granted ? null : 'Enable Health Connect from the Settings tab to sync your steps.');
      if (granted) {
        const id = await ensureUserId();
        if (id && userName) {
          await persistProfile(id, userName);
        }
        await fetchSteps(currentDate, { forceRefetch: true });
        await cachePreviousDays();
      }
    } else if (status === HealthConnectStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
      setHasPermissions(false);
      setErrorMessage('Install or update the Health Connect app from Google Play to sync your steps.');
    } else if (status === HealthConnectStatus.SDK_UNAVAILABLE) {
      setHasPermissions(false);
      setErrorMessage('Health Connect is unavailable right now. Update the Health Connect app and try again.');
    } else if (status === HealthConnectStatus.SDK_UNAVAILABLE_DEVICE_NOT_SUPPORTED) {
      setHasPermissions(false);
      setErrorMessage('Turn on “Allow access to Health Connect data” in the Health Connect app so Stepple can sync your steps.');
    } else {
      setHasPermissions(false);
      setErrorMessage(`Health Connect returned status code ${status}.`);
    }
  }, [cachePreviousDays, currentDate, ensureUserId, fetchSteps, persistProfile, userName]);

  useEffect(() => {
    refreshHealthConnect().catch(console.error);
  }, [refreshHealthConnect]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshHealthConnect().catch(console.error);
      }
    });
    return () => subscription.remove();
  }, [refreshHealthConnect]);

  useEffect(() => {
    if (hasPermissions) {
      fetchSteps(currentDate);
    }
  }, [currentDate, fetchSteps, hasPermissions]);

  useEffect(() => {
    let cancelled = false;
    const loadFriendSteps = async () => {
      if (friends.length === 0) {
        setFriendSteps({});
        return;
      }
      const dateId = getDateId(currentDate);
      const entries = await Promise.all(
        friends.map(async friend => {
          try {
            const snap = await getDoc(doc(db, 'users', friend.id, 'steps', dateId));
            if (snap.exists()) {
              const data = snap.data() as { count?: number };
              return [friend.id, typeof data.count === 'number' ? data.count : null] as const;
            }
          } catch (error) {
            console.warn('Failed to load friend steps', error);
          }
          return [friend.id, null] as const;
        }),
      );
      if (!cancelled) {
        setFriendSteps(prev => {
          const next = { ...prev };
          entries.forEach(([id, value]) => {
            next[id] = value;
          });
          return next;
        });
      }
    };

    loadFriendSteps().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [currentDate, friends]);

  useEffect(() => {
    let dotAnimation: ReturnType<typeof setInterval> | undefined;
    if (steps === null && hasPermissions) {
      setLoadingDots('.');
      dotAnimation = setInterval(() => {
        setLoadingDots(dots => {
          if (dots.length >= 3) {
            return '.';
          }
          return dots + '.';
        });
      }, 400);
    }
    return () => {
      if (dotAnimation !== undefined) {
        clearInterval(dotAnimation);
      }
    };
  }, [hasPermissions, steps]);

  const handlePreviousDay = () => {
    const newDate = new Date(currentDate.getTime() - DAY_IN_MS);
    setCurrentDate(newDate);
  };

  const handleNextDay = () => {
    const newDate = new Date(currentDate.getTime() + DAY_IN_MS);
    setCurrentDate(newDate);
  };

  const formatDate = (date: Date) => {
    if (isToday(date)) {
      return `Today, ${date.toLocaleDateString()}`;
    }
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday, ${date.toLocaleDateString()}`;
    }
    return date.toLocaleDateString();
  };

  return (
    <View style={styles.container}>
      <View style={styles.dateToggler}>
        <Pressable onPress={handlePreviousDay} style={styles.arrow}>
          <Text style={styles.arrowText}>{'<'}</Text>
        </Pressable>
        <Text style={styles.dateText}>{formatDate(currentDate)}</Text>
        <Pressable onPress={handleNextDay} disabled={isToday(currentDate)} style={styles.arrow}>
          <Text style={[styles.arrowText, isToday(currentDate) && styles.disabledArrow]}>{'>'}</Text>
        </Pressable>
      </View>
      <View style={styles.leaderboard}>
        <Text style={styles.title}>Leaderboard</Text>
        <View style={styles.leaderboardHeader}>
          <Text style={[styles.leaderboardHeaderText, styles.nameColumn]}>Name</Text>
          <Text style={[styles.leaderboardHeaderText, styles.stepsColumn]}>Steps</Text>
        </View>
        <View style={styles.leaderboardRow}>
          <Text style={[styles.leaderboardText, styles.nameColumn]}>{userName || '...'}</Text>
          <Text style={[styles.leaderboardText, styles.stepsColumn]}>{steps !== null ? steps : loadingDots}</Text>
        </View>
        {friends.map(friend => (
          <View key={friend.id} style={styles.leaderboardRow}>
            <Text style={[styles.leaderboardText, styles.nameColumn]}>{friend.name}</Text>
            <Text style={[styles.leaderboardText, styles.stepsColumn]}>
              {friendSteps[friend.id] !== undefined && friendSteps[friend.id] !== null ? friendSteps[friend.id] : '...'}
            </Text>
          </View>
        ))}
      </View>

      {errorMessage && <Text>{errorMessage}</Text>}
      {!hasPermissions && (
        <Button
          title="Open Settings to enable Health Connect"
          onPress={() => Linking.openURL('stepple://(tabs)/two')}
        />
      )}
      <Modal
        visible={isNameModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setNameModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Welcome!</Text>
            <Text style={styles.modalMessage}>What would you like to be called?</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your name here"
              onChangeText={setInputName}
              value={inputName}
            />
            <Button title="Save" onPress={async () => {
              if (inputName.trim()) {
                await AsyncStorage.setItem('userName', inputName.trim());
                setUserName(inputName.trim());
                setNameModalVisible(false);
                const id = await ensureUserId();
                if (id) {
                  await persistProfile(id, inputName.trim());
                }
                refreshHealthConnect().catch(console.error);
              }
            }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 100,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  dateToggler: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '80%',
    position: 'absolute',
    top: 25,
    zIndex: 1,
  },
  arrow: {
    padding: 10,
  },
  arrowText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  disabledArrow: {
    color: '#d3d3d3',
  },
  dateText: {
    fontSize: 18,
    fontWeight: '600',
  },
  leaderboard: {
    width: '90%',
  },
  leaderboardHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingVertical: 10,
  },
  leaderboardHeaderText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    paddingHorizontal: 5,
  },
  leaderboardRow: {
    flexDirection: 'row',
    paddingVertical: 15,
  },
  leaderboardText: {
    fontSize: 18,
    paddingHorizontal: 5,
  },
  nameColumn: {
    width: '70%',
    textAlign: 'left',
  },
  stepsColumn: {
    width: '30%',
    textAlign: 'left',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    width: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  modalMessage: {
    fontSize: 16,
    marginBottom: 15,
    textAlign: 'center',
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
});
