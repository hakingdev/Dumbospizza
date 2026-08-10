import { describe, expect, it } from 'vitest';
import {
  analyzeSmsText,
  composeSmsText,
  SMS_OPTOUT_FOOTER,
} from '../segments';

describe('analyzeSmsText', () => {
  it('пустой текст — 0 сегментов', () => {
    expect(analyzeSmsText('')).toEqual({
      encoding: 'GSM-7',
      units: 0,
      segments: 0,
      perSegment: 160,
    });
  });

  it('немецкий текст с äöüß остаётся GSM-7 и влезает в 1 сегмент', () => {
    const info = analyzeSmsText('Heiße Angebote: Größte Pizza für 5€ statt 7€!');
    expect(info.encoding).toBe('GSM-7');
    expect(info.segments).toBe(1);
  });

  it('160 GSM-знаков = 1 сегмент, 161 = 2 сегмента по 153', () => {
    expect(analyzeSmsText('a'.repeat(160))).toMatchObject({ segments: 1, perSegment: 160 });
    expect(analyzeSmsText('a'.repeat(161))).toMatchObject({ segments: 2, perSegment: 153 });
  });

  it('€ — расширенная таблица GSM-7, стоит 2 септета', () => {
    const info = analyzeSmsText('€' + 'a'.repeat(158));
    expect(info.encoding).toBe('GSM-7');
    expect(info.units).toBe(160);
    expect(info.segments).toBe(1);
    expect(analyzeSmsText('€' + 'a'.repeat(159)).segments).toBe(2);
  });

  it('эмодзи переключает в UCS-2 (70/67 на сегмент), суррогатная пара = 2 юнита', () => {
    const single = analyzeSmsText('🍕' + 'a'.repeat(68));
    expect(single).toMatchObject({ encoding: 'UCS-2', units: 70, segments: 1 });
    const double = analyzeSmsText('🍕' + 'a'.repeat(69));
    expect(double).toMatchObject({ encoding: 'UCS-2', units: 71, segments: 2, perSegment: 67 });
  });

  it('типографские кавычки „“ — не GSM-7', () => {
    expect(analyzeSmsText('„Angebot“').encoding).toBe('UCS-2');
  });
});

describe('composeSmsText', () => {
  it('добавляет Abmelde-Hinweis новой строкой', () => {
    expect(composeSmsText('Heute -20% auf alle Pizzen!')).toBe(
      `Heute -20% auf alle Pizzen!\n${SMS_OPTOUT_FOOTER}`
    );
  });

  it('не дублирует ссылку, если она уже в тексте', () => {
    const withLink = `Angebot! ${SMS_OPTOUT_FOOTER}`;
    expect(composeSmsText(withLink)).toBe(withLink);
  });

  it('пустое сообщение — пустая строка', () => {
    expect(composeSmsText('   ')).toBe('');
  });

  it('футер сам по себе GSM-7 (не удорожает SMS)', () => {
    expect(analyzeSmsText(SMS_OPTOUT_FOOTER).encoding).toBe('GSM-7');
  });
});
