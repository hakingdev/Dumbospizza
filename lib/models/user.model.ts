import bcrypt from 'bcryptjs';
import { createModel } from '../db/mongoose-compat';
import { users } from '../db/schema';

export interface IUser {
  name: string;
  email?: string;
  phoneNumber: string;
  password?: string;
  addresses?: {
    street: string;
    houseNumber: string;
    postalCode: string;
    city: string;
    floor?: string;
    notes?: string;
    isDefault?: boolean;
  }[];
  role: 'customer' | 'admin' | 'staff';
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BCRYPT_RE = /^\$2[aby]\$/;

export const User = createModel(users, {
  // password не возвращается по умолчанию (как select:false). Включается через select('+password').
  hidden: ['password'],
  methods: {
    async comparePassword(this: any, candidate: string): Promise<boolean> {
      if (!this.password) return false;
      return bcrypt.compare(candidate, this.password);
    },
  },
  // Хешируем пароль перед сохранением, если он задан и ещё не является bcrypt-хешем.
  preSave: async (doc) => {
    if (doc.password && !BCRYPT_RE.test(doc.password)) {
      doc.password = await bcrypt.hash(doc.password, 10);
    }
  },
});

export default User;
