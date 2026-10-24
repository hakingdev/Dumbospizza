/**
 * Какие «кусочки» сыпать на фото пиццы, когда гость выбрал добавку.
 * Подбор по названию (Mozzarella → стружка сыра, Salami → кружки, …);
 * null — добавка не кладётся на пиццу (напиток, гарнир), эффекта нет.
 */

export type ParticleShape = 'shred' | 'disc' | 'ring' | 'bit' | 'drop' | 'chunk';

export interface ParticleStyle {
  shape: ParticleShape;
  colors: string[];
}

const RULES: Array<{ match: RegExp; style: ParticleStyle }> = [
  {
    match: /käse|kaese|mozzarella|parmesan|gouda|emmentaler|cheddar|feta|gorgonzola|schafskäse|schmelz|cheese/i,
    style: { shape: 'shred', colors: ['#f6d77b', '#f3c94f', '#fbe7a1', '#eec25a'] },
  },
  {
    match: /zwiebel|onion/i,
    style: { shape: 'ring', colors: ['#9b4d8a', '#b46aa6', '#c98bbb'] },
  },
  {
    match: /olive/i,
    style: { shape: 'ring', colors: ['#2f2a28', '#4a423c', '#5b6b2f'] },
  },
  {
    match: /salami|peperoni(?!.*grün)|pepperoni|schinken|speck|bacon|wurst|chorizo|tomate|tomato|sucuk|hack|rind|kebab/i,
    style: { shape: 'disc', colors: ['#b8322a', '#c94a36', '#9e2a22', '#d0563f'] },
  },
  {
    match: /hähnchen|haehnchen|chicken|pute|thunfisch|tuna|garnele|shrimp/i,
    style: { shape: 'chunk', colors: ['#e2b98a', '#d9a771', '#efcfa6'] },
  },
  {
    match: /champignon|pilz|mushroom/i,
    style: { shape: 'chunk', colors: ['#d8c3a5', '#c4a985', '#e6d6bf'] },
  },
  {
    match: /mais|corn|ananas|pineapple/i,
    style: { shape: 'chunk', colors: ['#f5c842', '#f0b92b', '#f9d870'] },
  },
  {
    match: /jalape|paprika|peperoni grün|rucola|basilikum|spinat|brokkoli|kräuter|petersilie|oregano|gurke|artischocke/i,
    style: { shape: 'bit', colors: ['#4f8a3c', '#6aa84f', '#3d7a2e', '#8bbf63'] },
  },
  {
    match: /bbq/i,
    style: { shape: 'drop', colors: ['#6b3420', '#7d3f26', '#5a2b1a'] },
  },
  {
    match: /soße|sosse|sauce|ketchup|tomatensoße|chili|sriracha/i,
    style: { shape: 'drop', colors: ['#c0392b', '#d35400', '#b03a2e'] },
  },
  {
    match: /mayo|knoblauch|aioli|garlic|creme|crème|hollandaise|ranch/i,
    style: { shape: 'drop', colors: ['#f6efd9', '#efe3c2', '#fbf6e8'] },
  },
];

export function particleStyleFor(name: string): ParticleStyle | null {
  const value = String(name || '');
  for (const rule of RULES) {
    if (rule.match.test(value)) return rule.style;
  }
  return null;
}

export interface Particle {
  /** Точка приземления, % от сцены. */
  left: number;
  top: number;
  /** С какой высоты падает (px) и как поворачивается в полёте. */
  fall: number;
  spin: number;
  delay: number;
  color: string;
  shape: ParticleShape;
}

/**
 * Кусочки ложатся на саму пиццу: фото вписано по центру сцены, поэтому круг
 * приземления считаем от меньшей стороны сцены, а не в % от каждой стороны
 * (иначе на широкой сцене кусочки падали мимо пиццы).
 */
export function makeParticles(
  style: ParticleStyle,
  box: { width: number; height: number },
  count = 20,
  random: () => number = Math.random
): Particle[] {
  const particles: Particle[] = [];
  const radius = Math.min(box.width, box.height) * 0.3;
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    particles.push({
      left: 50 + ((Math.cos(angle) * distance) / Math.max(box.width, 1)) * 100,
      top: 50 + ((Math.sin(angle) * distance) / Math.max(box.height, 1)) * 100,
      fall: 120 + random() * 90,
      spin: (random() - 0.5) * 220,
      delay: random() * 0.18,
      color: style.colors[Math.floor(random() * style.colors.length)],
      shape: style.shape,
    });
  }
  return particles;
}
