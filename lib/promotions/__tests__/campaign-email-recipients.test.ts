// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  orderMock,
  pushDeviceMock,
  campaignLogMock,
  promotionMock,
  sendEmailMock,
} = vi.hoisted(() => ({
  orderMock: { distinct: vi.fn() },
  pushDeviceMock: { find: vi.fn() },
  campaignLogMock: { create: vi.fn() },
  promotionMock: { findByIdAndUpdate: vi.fn() },
  sendEmailMock: vi.fn(),
}));

vi.mock('../../models/order.model', () => ({
  Order: orderMock,
}));

vi.mock('../../models/push-device.model', () => ({
  PushDevice: pushDeviceMock,
}));

vi.mock('../../models/promotion-campaign-log.model', () => ({
  PromotionCampaignLog: campaignLogMock,
}));

vi.mock('../../models/promotion.model', () => ({
  Promotion: promotionMock,
}));

vi.mock('../../email', () => ({
  isEmailConfigured: vi.fn(() => true),
  sendEmail: sendEmailMock,
}));

vi.mock('../../push-notifications', () => ({
  isPushConfigured: vi.fn(() => true),
  sendFcmToTokens: vi.fn(),
}));

// Suppression-Liste (Abmeldungen) hängt an der DB — im Test neutralisieren:
// nichts ist abgemeldet, also Liste unverändert.
vi.mock('../../email/suppression', () => ({
  filterUnsubscribed: vi.fn(async (emails: string[]) => emails),
}));

import { sendPromotionEmailCampaign } from '../campaign';

const promo = {
  _id: 'promo_1',
  name: 'Lunch Deal',
  slug: 'lunch-deal',
  emailSubject: 'Heute sparen',
  emailBodyHtml: '<p>Pizza wartet.</p>',
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  campaignLogMock.create.mockResolvedValue({});
  promotionMock.findByIdAndUpdate.mockResolvedValue({});
});

describe('sendPromotionEmailCampaign manual recipients', () => {
  it('uses uploaded recipients instead of order emails and records the campaign result', async () => {
    sendEmailMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('SMTP rejected'));

    const result = await sendPromotionEmailCampaign(promo, {
      recipients: ['First@Example.com', 'second@example.com', 'first@example.com'],
    });

    expect(orderMock.distinct).not.toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    // HTML enthält jetzt zusätzlich die Abmelde-Fußzeile + List-Unsubscribe-Header.
    expect(sendEmailMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ to: 'first@example.com', subject: 'Heute sparen' })
    );
    expect(sendEmailMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: 'second@example.com', subject: 'Heute sparen' })
    );
    const firstCall = sendEmailMock.mock.calls[0][0];
    expect(firstCall.html).toContain('<p>Pizza wartet.</p>');
    expect(firstCall.html).toContain('abmelden');
    expect(firstCall.headers['List-Unsubscribe']).toContain('/api/email/unsubscribe?token=');
    expect(result).toEqual({
      recipientCount: 2,
      successCount: 1,
      failureCount: 1,
      failures: [{ email: 'second@example.com', error: 'SMTP rejected' }],
    });
    expect(promotionMock.findByIdAndUpdate).toHaveBeenCalledWith('promo_1', {
      emailSentAt: expect.any(Date),
      $inc: { emailSentCount: 1 },
    });
    expect(campaignLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        promotionId: 'promo_1',
        channel: 'email',
        triggeredBy: 'manual',
        recipientCount: 2,
        successCount: 1,
        failureCount: 1,
        subject: 'Heute sparen',
      })
    );
  });

  it('sends large lists in batches and records a failure summary in the log', async () => {
    const recipients = Array.from({ length: 120 }, (_, i) => `person-${i}@example.com`);
    // Fail every recipient whose index is a multiple of 40.
    sendEmailMock.mockImplementation(({ to }: { to: string }) => {
      const index = Number(to.match(/person-(\d+)@/)?.[1]);
      return index % 40 === 0
        ? Promise.reject(new Error('SMTP rejected'))
        : Promise.resolve(undefined);
    });

    const result = await sendPromotionEmailCampaign(promo, { recipients });

    expect(sendEmailMock).toHaveBeenCalledTimes(120);
    expect(result.recipientCount).toBe(120);
    expect(result.successCount).toBe(117);
    expect(result.failureCount).toBe(3);
    expect(result.failures).toEqual([
      { email: 'person-0@example.com', error: 'SMTP rejected' },
      { email: 'person-40@example.com', error: 'SMTP rejected' },
      { email: 'person-80@example.com', error: 'SMTP rejected' },
    ]);
    expect(campaignLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCount: 3,
        error: expect.stringContaining('3 fehlgeschlagen'),
      })
    );
  });

  it('rejects empty manual recipient lists before touching SMTP', async () => {
    await expect(
      sendPromotionEmailCampaign(promo, { recipients: ['bad-address', ''] })
    ).rejects.toThrow('No valid email recipients');

    expect(orderMock.distinct).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(campaignLogMock.create).not.toHaveBeenCalled();
  });

  it('keeps test email sends out of promotion sent counters', async () => {
    sendEmailMock.mockResolvedValue(undefined);

    const result = await sendPromotionEmailCampaign(promo, {
      testEmail: 'TEST@Example.com',
    });

    expect(result).toEqual({
      recipientCount: 1,
      successCount: 1,
      failureCount: 0,
      failures: [],
    });
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'test@example.com', subject: 'Heute sparen' })
    );
    expect(promotionMock.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(campaignLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientCount: 1,
        successCount: 1,
        failureCount: 0,
      })
    );
  });
});
