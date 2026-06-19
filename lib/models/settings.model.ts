import { createModel } from '../db/mongoose-compat';
import { settings } from '../db/schema';

export interface ISetting {
  key: string;
  value: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export const Settings = createModel(settings);

export default Settings;
