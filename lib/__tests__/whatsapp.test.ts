import { beforeEach, describe, expect, it, vi } from 'vitest';

const queueMock = vi.hoisted(() => ({
  findOne: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../models/whatsapp-queue.model', () => ({
  WhatsAppQueue: queueMock,
  default: queueMock,
}));

import { enqueueWhatsAppMessageOnce } from '../whatsapp';

describe('enqueueWhatsAppMessageOnce', () => {
  beforeEach(() => {
    queueMock.findOne.mockReset();
    queueMock.create.mockReset();
  });

  it('does not enqueue a duplicate pending/sent message for the same order', async () => {
    queueMock.findOne.mockResolvedValue({ id: 'existing' });

    const queued = await enqueueWhatsAppMessageOnce({
      phone: '+491234567',
      text: 'Ihre Bestellung 260623008 wurde zugestellt.',
      orderId: '260623008',
    });

    expect(queued).toBe(false);
    expect(queueMock.create).not.toHaveBeenCalled();
  });

  it('enqueues the first message for an order', async () => {
    queueMock.findOne.mockResolvedValue(null);
    queueMock.create.mockResolvedValue({ id: 'new' });

    const queued = await enqueueWhatsAppMessageOnce({
      phone: '+491234567',
      text: 'Ihre Bestellung 260623008 wurde zugestellt.',
      orderId: '260623008',
    });

    expect(queued).toBe(true);
    expect(queueMock.create).toHaveBeenCalledWith({
      phone: '+491234567',
      text: 'Ihre Bestellung 260623008 wurde zugestellt.',
      status: 'pending',
      orderId: '260623008',
    });
  });

  it('treats in-flight (sending) messages as already queued to avoid re-enqueue', async () => {
    queueMock.findOne.mockResolvedValue(null);
    queueMock.create.mockResolvedValue({ id: 'new' });

    await enqueueWhatsAppMessageOnce({
      phone: '+491234567',
      text: 'Vielen Dank für Ihre Bestellung!',
      orderId: '260623009',
    });

    // The dedup lookup must include 'sending' so a message that was already
    // claimed for delivery by the worker is never enqueued a second time.
    expect(queueMock.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: '260623009',
        status: { $in: ['pending', 'sending', 'sent'] },
      })
    );
  });
});
