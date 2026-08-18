import { describe, it, expect } from 'vitest';
import {
  POS_ETA_MAX_MINUTES,
  POS_ETA_STEP,
  posDesiredChoice,
  posEtaView,
  posShiftEta,
  type PosEtaChoice,
} from '../eta-choice';

/** 18 августа 2026, 19:00 по Берлину. */
const NOW = new Date('2026-08-18T17:00:00Z').getTime();
const at = (iso: string) => new Date(iso).getTime();
/** Wunschzeit 20:30 по Берлину. */
const DESIRED = at('2026-08-18T18:30:00Z');

describe('заказ на время', () => {
  it('окно встаёт ровно на желаемый час', () => {
    const choice = posDesiredChoice(DESIRED, NOW);
    expect(choice).toEqual({ mode: 'at', ms: DESIRED });

    const view = posEtaView(choice!, NOW);
    expect(view.targetMs).toBe(DESIRED); // крупно — 20:30, а не «сейчас + 90»
    expect(view.minutes).toBe(90); // столько уедет в etaMinutes
    expect(view.clamped).toBe(false);
  });

  it('±5 двигает желаемый час, а не отступ от «сейчас»', () => {
    let choice: PosEtaChoice = { mode: 'at', ms: DESIRED };
    choice = posShiftEta(choice, POS_ETA_STEP, NOW);
    expect(posEtaView(choice, NOW).targetMs).toBe(at('2026-08-18T18:35:00Z')); // 20:35

    choice = posShiftEta(choice, -POS_ETA_STEP * 2, NOW);
    expect(posEtaView(choice, NOW).targetMs).toBe(at('2026-08-18T18:25:00Z')); // 20:25
  });

  it('названный час не уезжает, пока кухня читает состав', () => {
    const choice: PosEtaChoice = { mode: 'at', ms: DESIRED };
    const later = NOW + 20 * 60_000;
    expect(posEtaView(choice, later).targetMs).toBe(DESIRED); // всё ещё 20:30
    expect(posEtaView(choice, later).minutes).toBe(70); // обещание тает вместе с ожиданием
  });

  it('прошедший час не подставляет — обещать наступившее время нечестно', () => {
    expect(posDesiredChoice(DESIRED, DESIRED - 60_000)).toBeNull();
    expect(posDesiredChoice(null, NOW)).toBeNull();
  });

  it('час дальше предела урезает и говорит об этом', () => {
    const far = NOW + 240 * 60_000;
    const view = posEtaView({ mode: 'at', ms: far }, NOW);
    expect(view.minutes).toBe(POS_ETA_MAX_MINUTES);
    expect(view.clamped).toBe(true);
    // Урезанное обещание показывается тем, чем оно стало, а не желаемым часом.
    expect(view.targetMs).toBe(NOW + POS_ETA_MAX_MINUTES * 60_000);
  });

  it('шаг не выводит за границы сервера', () => {
    const low = posShiftEta({ mode: 'at', ms: NOW + 5 * 60_000 }, -POS_ETA_STEP, NOW);
    expect(posEtaView(low, NOW).minutes).toBe(5);

    const high = posShiftEta({ mode: 'at', ms: NOW + POS_ETA_MAX_MINUTES * 60_000 }, POS_ETA_STEP, NOW);
    expect(posEtaView(high, NOW).minutes).toBe(POS_ETA_MAX_MINUTES);
  });
});

describe('заказ на сейчас', () => {
  it('час готовности едет вместе с часами', () => {
    const choice: PosEtaChoice = { mode: 'in', minutes: 30 };
    expect(posEtaView(choice, NOW).targetMs).toBe(NOW + 30 * 60_000);
    const later = NOW + 10 * 60_000;
    expect(posEtaView(choice, later).targetMs).toBe(later + 30 * 60_000);
    expect(posEtaView(choice, later).minutes).toBe(30);
  });

  it('±5 меняет минуты и не выходит за границы', () => {
    expect(posShiftEta({ mode: 'in', minutes: 30 }, POS_ETA_STEP, NOW)).toEqual({
      mode: 'in',
      minutes: 35,
    });
    expect(posShiftEta({ mode: 'in', minutes: 5 }, -POS_ETA_STEP, NOW)).toEqual({
      mode: 'in',
      minutes: 5,
    });
    expect(posShiftEta({ mode: 'in', minutes: 180 }, POS_ETA_STEP, NOW)).toEqual({
      mode: 'in',
      minutes: 180,
    });
  });

  it('до сверки часов показывать нечего, но экран не падает', () => {
    expect(posEtaView({ mode: 'in', minutes: 30 }, null).targetMs).toBeNull();
    // Вид «к 20:30» знает свой час и без часов прибора.
    expect(posEtaView({ mode: 'at', ms: DESIRED }, null).targetMs).toBe(DESIRED);
  });
});
