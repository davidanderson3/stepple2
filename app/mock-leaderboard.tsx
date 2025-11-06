import { Stack } from 'expo-router';
import { StyleSheet, Text, View, Pressable } from 'react-native';

const MOCK_DATE_LABEL = 'Today, Oct 1';

const MOCK_ENTRIES = [
  { name: 'You', steps: 12840, highlight: true },
  { name: 'Riley', steps: 12410 },
  { name: 'Morgan', steps: 11054 },
  { name: 'Avery', steps: 9876 },
  { name: 'Jordan', steps: 8450 },
];

export default function MockLeaderboardScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Leaderboard Preview',
        }}
      />
      <View style={styles.container}>
        <View style={styles.dateToggler}>
          <Pressable style={styles.arrow}>
            <Text style={styles.arrowText}>{'<'}</Text>
          </Pressable>
          <Text style={styles.dateText}>{MOCK_DATE_LABEL}</Text>
          <Pressable style={styles.arrow}>
            <Text style={[styles.arrowText, styles.disabledArrow]}>{'>'}</Text>
          </Pressable>
        </View>

        <View style={styles.leaderboard}>
          <Text style={styles.title}>Leaderboard</Text>
          <View style={styles.leaderboardHeader}>
            <Text style={[styles.leaderboardHeaderText, styles.nameColumn]}>Name</Text>
            <Text style={[styles.leaderboardHeaderText, styles.stepsColumn]}>Steps</Text>
          </View>
          {MOCK_ENTRIES.map(entry => (
            <View
              key={entry.name}
              style={[styles.leaderboardRow, entry.highlight && styles.highlightRow]}
            >
              <Text style={[styles.leaderboardText, styles.nameColumn]}>{entry.name}</Text>
              <Text style={[styles.leaderboardText, styles.stepsColumn]}>{entry.steps.toLocaleString()}</Text>
            </View>
          ))}
        </View>

        <View style={styles.footerCard}>
          <Text style={styles.footerTitle}>Daily Streak</Text>
          <Text style={styles.footerSubtitle}>6 days in a row — keep it going!</Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f8fb',
    paddingTop: 80,
    paddingHorizontal: 20,
  },
  dateToggler: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  arrowText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2d2d2d',
  },
  disabledArrow: {
    opacity: 0.35,
  },
  dateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f1f2e',
  },
  leaderboard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1f1f2e',
    marginBottom: 16,
  },
  leaderboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  leaderboardHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: '#6f7581',
    letterSpacing: 1,
  },
  leaderboardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eceef5',
  },
  highlightRow: {
    backgroundColor: '#eef7ff',
    borderRadius: 12,
    paddingHorizontal: 12,
    marginHorizontal: -12,
  },
  nameColumn: {
    flex: 1.4,
  },
  stepsColumn: {
    flex: 1,
    textAlign: 'right',
  },
  leaderboardText: {
    fontSize: 16,
    color: '#1f1f2e',
  },
  footerCard: {
    marginTop: 24,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  footerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f1f2e',
    marginBottom: 4,
  },
  footerSubtitle: {
    fontSize: 15,
    color: '#4b4d57',
  },
});
