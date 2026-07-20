import { createModel } from '../db/mongoose-compat';
import { userIdentities } from '../db/schema';

/**
 * Привязка аккаунта к внешнему провайдеру входа (Google / Apple).
 * Один пользователь может иметь несколько записей — по одной на провайдера.
 */
export interface IUserIdentity {
  user: string;
  provider: 'google' | 'apple';
  /** Стабильный `sub` из id_token провайдера. */
  subject: string;
  email?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// populate не нужен: пользователя всегда достаём отдельным findById по user.
export const UserIdentity = createModel(userIdentities);

export default UserIdentity;
