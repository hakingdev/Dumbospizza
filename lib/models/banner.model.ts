import { createModel } from '../db/mongoose-compat';
import { homepageBanners } from '../db/schema';

/**
 * Рекламный баннер слайдера на главной. В отличие от Promotion не считает
 * скидку — это только картинка со ссылкой, которую ведёт ресторан.
 */
export interface IHomepageBanner {
  title: string;
  subtitle?: string;
  image: string;
  linkUrl?: string;
  badgeText?: string;
  enabled: boolean;
  order: number;
  /** Дни показа: 0 = Вс … 6 = Сб. Все семь = «показывать всегда». */
  activeDaysOfWeek: number[];
  scheduleTimeZone: string;
  createdAt: Date;
  updatedAt: Date;
}

export const HomepageBanner = createModel(homepageBanners);

export default HomepageBanner;
