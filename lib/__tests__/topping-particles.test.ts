import { describe, it, expect } from 'vitest';
import { makeParticles, particleStyleFor } from '../topping-particles';

describe('particleStyleFor', () => {
  it('подбирает кусочки по названию добавки', () => {
    expect(particleStyleFor('Mozzarella')?.shape).toBe('shred');
    expect(particleStyleFor('Parmesan')?.shape).toBe('shred');
    expect(particleStyleFor('Salami')?.shape).toBe('disc');
    expect(particleStyleFor('Rote Zwiebeln')?.shape).toBe('ring');
    expect(particleStyleFor('Jalapeños')?.shape).toBe('bit');
    expect(particleStyleFor('BBQ-Soße')?.shape).toBe('drop');
  });

  it('не сыплет на пиццу то, что на неё не кладут', () => {
    expect(particleStyleFor('Coca-Cola 0,33 l')).toBeNull();
    expect(particleStyleFor('Pommes frites')).toBeNull();
  });
});

describe('makeParticles', () => {
  it('на широкой сцене кусочки ложатся в круг по меньшей стороне — на пиццу', () => {
    const style = particleStyleFor('Mozzarella')!;
    const box = { width: 340, height: 200 };
    const particles = makeParticles(style, box, 40);
    expect(particles).toHaveLength(40);
    for (const p of particles) {
      const dx = ((p.left - 50) / 100) * box.width;
      const dy = ((p.top - 50) / 100) * box.height;
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(200 * 0.3 + 0.001);
      expect(style.colors).toContain(p.color);
    }
  });
});
