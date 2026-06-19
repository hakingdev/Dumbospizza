/* Рантайм-проверка Mongoose-совместимого слоя на живой Supabase. Запуск:
   export DATABASE_URL='...'; npx tsx scripts/test-compat.ts  */
import { Category } from '../lib/models/category.model';
import { Product } from '../lib/models/product.model';
import { Order } from '../lib/models/order.model';
import { Coupon } from '../lib/models/coupon.model';
import { OptionGroup } from '../lib/models/option-group.model';
import { Settings } from '../lib/models/settings.model';
import { PreOrder } from '../lib/models/pre-order.model';
import { getProducts, getAdminDashboardStats, getDailySales } from '../lib/db/utils';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, extra ?? '');
  }
}

async function main() {
  // 1. find + sort
  const cats = await Category.find().sort({ order: 1 });
  check('Category.find().sort() → 5', cats.length === 5, cats.length);
  check('Category doc has _id', typeof cats[0]?._id === 'string');

  // 2. find + populate(scalar)
  const products = await Product.find({ available: true }).sort({ name: 1 }).populate('category');
  check('Product.find(available).populate(category) непусто', products.length > 0, products.length);
  const withCat = products.find((p: any) => p.category && typeof p.category === 'object');
  check('product.category раскрыт в объект', !!withCat, typeof products[0]?.category);
  check('populated category имеет name', typeof withCat?.category?.name === 'string');

  // 3. findById + nested populate (array → optionGroups → optionIds → options)
  const pid = products[0]._id;
  const one = await Product.findById(pid)
    .populate('category')
    .populate({ path: 'optionGroupIds', strictPopulate: false, populate: { path: 'optionIds', strictPopulate: false } });
  check('Product.findById().populate(nested) ок', !!one && one._id === pid);

  // 4. orders: sort/limit, jsonb items, _id
  const orders = await Order.find().sort({ createdAt: -1 }).limit(3);
  check('Order.find().sort().limit(3)', orders.length === 3, orders.length);
  check('order.items — массив', Array.isArray(orders[0]?.items));
  check('order.orderNumber присутствует', typeof orders[0]?.orderNumber === 'string');

  // 5. countDocuments
  const totalOrders = await Order.countDocuments();
  check('Order.countDocuments() == 454', totalOrders === 454, totalOrders);
  const statusCount = await Order.countDocuments({ status: { $in: ['new', 'completed'] } });
  check('countDocuments($in) > 0', statusCount > 0, statusCount);

  // 6. coupon findOne
  const anyCoupon = await Coupon.findOne({});
  check('Coupon.findOne() ок', !!anyCoupon?._id);

  // 7. OptionGroup.find().populate(optionIds array)
  const groups = await OptionGroup.find().populate('optionIds');
  check('OptionGroup.find().populate(optionIds)', groups.length > 0, groups.length);
  const og = groups.find((g: any) => Array.isArray(g.optionIds) && g.optionIds.length > 0);
  check('optionIds раскрыт в массив объектов', !og || typeof og.optionIds[0] === 'object');

  // 8. settings value (jsonb object with tokens)
  const store = await Settings.findOne({ key: 'storeSettings' });
  check('Settings storeSettings.value — объект', !!store && typeof store.value === 'object');

  // 9. utils getProducts (category slug lookup + populate)
  const pizza = await getProducts({ available: true });
  check('getProducts() непусто', pizza.length > 0, pizza.length);

  // 10. aggregate helpers
  const stats = await getAdminDashboardStats();
  check('getAdminDashboardStats totalOrders', stats.totalOrders === 454, stats.totalOrders);
  check('getAdminDashboardStats todaySales — число', typeof stats.todaySales === 'number');
  const daily = await getDailySales(30);
  check('getDailySales() вернул массив', Array.isArray(daily), daily.length);

  // 11. create + save (insert path, genObjectId) + findByIdAndUpdate + delete
  const pre: any = new (PreOrder as any)({ name: 'TEST', phone: '0000', address: 'X' });
  await pre.save();
  check('PreOrder insert получил id (24hex)', /^[a-f0-9]{24}$/.test(pre._id), pre._id);
  const upd = await PreOrder.findByIdAndUpdate(pre._id, { name: 'TEST2' });
  check('findByIdAndUpdate вернул обновлённое', upd?.name === 'TEST2', upd?.name);
  const del = await PreOrder.findByIdAndDelete(pre._id);
  check('findByIdAndDelete вернул документ', del?._id === pre._id);
  const gone = await PreOrder.findById(pre._id);
  check('после delete findById → null', gone === null);

  console.log(`\nИТОГО: ${pass} ✓ / ${fail} ✗`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
