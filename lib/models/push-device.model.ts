import { createModel } from '../db/mongoose-compat';
import { pushDevices } from '../db/schema';

export interface IPushDevice {
  token: string;
  platform: 'android' | 'ios' | 'web';
  promoOptIn: boolean;
  locale?: string;
  appVersion?: string;
  phoneNumber?: string;
  email?: string;
  active: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const PushDevice = createModel(pushDevices);

export default PushDevice;
