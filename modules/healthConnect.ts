import { NativeModules, Platform } from 'react-native';

const { HealthConnectModule } = NativeModules;

type HealthConnectModuleType = {
  getSdkStatus(): Promise<number>;
  hasPermissions(): Promise<boolean>;
  requestPermissions(): Promise<boolean>;
  readSteps(startMillis: number, endMillis: number): Promise<number>;
  openSettings(): Promise<void>;
};

const noopModule: HealthConnectModuleType = {
  async getSdkStatus() {
    return -1;
  },
  async hasPermissions() {
    return false;
  },
  async requestPermissions() {
    return false;
  },
  async readSteps() {
    return 0;
  },
  async openSettings() {
    return;
  },
};

const Module: HealthConnectModuleType =
  Platform.OS === 'android' && HealthConnectModule
    ? (HealthConnectModule as HealthConnectModuleType)
    : noopModule;

export enum HealthConnectStatus {
  SDK_AVAILABLE = 0,
  SDK_UNAVAILABLE = 1,
  SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED = 2,
  SDK_UNAVAILABLE_DEVICE_NOT_SUPPORTED = 3,
}

export default Module;
