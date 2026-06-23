// @vitest-environment node
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signCustomerToken, verifyCustomerToken } from '../customer-auth';

describe('customer session token', () => {
  it('подписывает и проверяет валидный токен', () => {
    const token = signCustomerToken('user-123');
    expect(verifyCustomerToken(token)).toEqual({ userId: 'user-123' });
  });

  it('отклоняет мусорный токен', () => {
    expect(verifyCustomerToken('not-a-jwt')).toBeNull();
  });

  it('отклоняет токен с чужой audience (нельзя подменить admin-токеном)', () => {
    const secret = process.env.NEXTAUTH_SECRET || 'pizza-delivery-secret';
    const foreign = jwt.sign({ sub: 'user-123', aud: 'admin' }, secret);
    expect(verifyCustomerToken(foreign)).toBeNull();
  });

  it('отклоняет токен, подписанный другим секретом', () => {
    const forged = jwt.sign({ sub: 'user-123', aud: 'customer' }, 'wrong-secret');
    expect(verifyCustomerToken(forged)).toBeNull();
  });
});
