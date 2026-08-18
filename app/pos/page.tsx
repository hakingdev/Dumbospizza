import { redirect } from 'next/navigation';

/** Корень терминала ведёт в ленту заказов — экран, на котором прибор живёт. */
export default function PosIndexPage() {
  redirect('/pos/orders');
}
