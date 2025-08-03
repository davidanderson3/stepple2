import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

export default function TabTwoScreen() {
  const investmentReturnRate = 0; // Placeholder value
  const savingsReturnRate = 0; // Placeholder value

  return (
    <View style={styles.container}>
      <Text style={styles.category}>Investment Accounts</Text>
      <Text style={styles.rate}>Investment Return Rate: {investmentReturnRate}%</Text>

      <Text style={[styles.category, styles.sectionSpacing]}>Savings</Text>
      <Text style={styles.rate}>
        Savings Account Return Rate: {savingsReturnRate}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  category: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  sectionSpacing: {
    marginTop: 24,
  },
  rate: {
    fontSize: 16,
  },
});
