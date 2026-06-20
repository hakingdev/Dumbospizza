/**
 * Тонкий Mongoose-совместимый слой над Drizzle.
 *
 * Цель: сохранить привычный интерфейс моделей (`Model.find().sort().populate()`,
 * `Model.findById()`, `new Model(data).save()`, инстанс-методы, хуки pre-save),
 * чтобы при переходе MongoDB→Supabase не переписывать ~170 вызовов в роутах.
 *
 * Поддерживается ровно тот поднабор API, что реально используется в проекте.
 * «Тяжёлые» места (aggregate, транзакции) написаны на Drizzle напрямую.
 */
import {
  and,
  or,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  ilike,
  asc,
  desc,
  isNull,
  isNotNull,
  sql,
  getTableColumns,
  type SQL,
} from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import db from './client';
import { genObjectId } from './object-id';

type AnyRecord = Record<string, any>;
type AnyTable = PgTable<any> & AnyRecord;

export interface ModelConfig {
  /** path → функция, возвращающая связанную таблицу (для populate) */
  populate?: Record<string, () => AnyTable>;
  /** колонки, скрытые по умолчанию (как select:false). Включаются через select('+col') */
  hidden?: string[];
  /** инстанс-методы документа (this === документ) */
  methods?: Record<string, (this: any, ...args: any[]) => any>;
  /** хук перед сохранением (генерация orderNumber, хеш пароля и т.п.) */
  preSave?: (doc: any, isNew: boolean) => Promise<void> | void;
}

interface ModelRef {
  table: AnyTable;
  columns: Record<string, PgColumn>;
  colKeys: string[];
  config: ModelConfig;
}

/** path → ref-таблица, по контейнерной таблице (для populate, в т.ч. вложенного). */
const POPULATE_REGISTRY = new Map<AnyTable, Record<string, () => AnyTable>>();

interface PopSpec {
  path: string;
  fields?: string;
  populate?: PopSpec;
}

function normPop(arg: string | AnyRecord, fields?: string): PopSpec {
  if (typeof arg === 'string') return { path: arg, fields };
  return {
    path: arg.path,
    fields: arg.select,
    populate: arg.populate ? normPop(arg.populate) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Хелперы колонок / where / projection
// ---------------------------------------------------------------------------
function colFor(model: ModelRef, field: string): PgColumn | undefined {
  if (field === '_id' || field === 'id') return model.columns.id;
  return model.columns[field];
}

function leafCondition(col: PgColumn, val: any): SQL | undefined {
  if (val instanceof RegExp) return ilike(col, `%${val.source}%`);
  if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
    const conds: (SQL | undefined)[] = [];
    for (const [op, v] of Object.entries(val)) {
      switch (op) {
        case '$in':
          conds.push(inArray(col, v as any[]));
          break;
        case '$nin':
          conds.push(notInArray(col, v as any[]));
          break;
        case '$gte':
          conds.push(gte(col, v as any));
          break;
        case '$lte':
          conds.push(lte(col, v as any));
          break;
        case '$gt':
          conds.push(gt(col, v as any));
          break;
        case '$lt':
          conds.push(lt(col, v as any));
          break;
        case '$ne':
          conds.push(ne(col, v as any));
          break;
        case '$eq':
          conds.push(eq(col, v as any));
          break;
        case '$exists':
          conds.push(v ? isNotNull(col) : isNull(col));
          break;
        case '$regex': {
          const src = v instanceof RegExp ? v.source : String(v);
          conds.push(ilike(col, `%${src}%`));
          break;
        }
        default:
          throw new Error(`mongoose-compat: неподдерживаемый оператор ${op}`);
      }
    }
    return and(...(conds.filter(Boolean) as SQL[]));
  }
  return eq(col, val);
}

function buildWhere(model: ModelRef, query: AnyRecord = {}): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  for (const [key, val] of Object.entries(query)) {
    if (key === '$or') {
      conds.push(or(...(val as AnyRecord[]).map((q) => buildWhere(model, q)!).filter(Boolean)));
      continue;
    }
    if (key === '$and') {
      conds.push(and(...(val as AnyRecord[]).map((q) => buildWhere(model, q)!).filter(Boolean)));
      continue;
    }
    const col = colFor(model, key);
    if (!col) throw new Error(`mongoose-compat: нет колонки для поля "${key}"`);
    conds.push(leafCondition(col, val));
  }
  const filtered = conds.filter(Boolean) as SQL[];
  if (filtered.length === 0) return undefined;
  return filtered.length === 1 ? filtered[0] : and(...filtered);
}

function buildOrderBy(model: ModelRef, sortObj?: Record<string, 1 | -1>): SQL[] {
  if (!sortObj) return [];
  const out: SQL[] = [];
  for (const [field, dir] of Object.entries(sortObj)) {
    const col = colFor(model, field);
    if (!col) continue;
    out.push((dir === -1 ? desc(col) : asc(col)) as SQL);
  }
  return out;
}

/** Разбор строки select: 'name image', '-password', '+password token' */
function parseSelect(select?: string) {
  if (!select) return { include: [] as string[], exclude: [] as string[], plus: [] as string[] };
  const include: string[] = [];
  const exclude: string[] = [];
  const plus: string[] = [];
  for (const raw of select.split(/\s+/).filter(Boolean)) {
    if (raw.startsWith('+')) plus.push(raw.slice(1));
    else if (raw.startsWith('-')) exclude.push(raw.slice(1));
    else include.push(raw);
  }
  return { include, exclude, plus };
}

/** Применить projection (select + hidden) к плоскому объекту строки. */
function project(model: ModelRef, row: AnyRecord, select?: string): AnyRecord {
  const { include, exclude, plus } = parseSelect(select);
  const hidden = (model.config.hidden || []).filter((h) => !plus.includes(h));
  const out: AnyRecord = { ...row };
  out._id = row.id;
  if (include.length > 0) {
    const keep = new Set([...include, 'id', '_id']);
    for (const k of Object.keys(out)) if (!keep.has(k)) delete out[k];
  }
  for (const h of hidden) delete out[h];
  for (const e of exclude) delete out[e];
  return out;
}

// ---------------------------------------------------------------------------
// Populate (scalar + array, вложенный, по реестру таблиц)
// ---------------------------------------------------------------------------
async function applyPopulate(containerTable: AnyTable, docs: AnyRecord[], specs: PopSpec[]) {
  const reg = POPULATE_REGISTRY.get(containerTable);
  if (!reg) return;
  for (const spec of specs) {
    const refFn = reg[spec.path];
    if (!refFn) continue;
    const refTable = refFn();

    const idSet = new Set<string>();
    for (const d of docs) {
      const v = d[spec.path];
      if (typeof v === 'string') idSet.add(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') idSet.add(x);
    }
    if (idSet.size === 0) continue;

    const rows = (await db
      .select()
      .from(refTable)
      .where(inArray((refTable as any).id, Array.from(idSet)))) as AnyRecord[];

    const incl = spec.fields ? spec.fields.split(/\s+/).filter(Boolean) : null;
    const byId = new Map<string, AnyRecord>();
    for (const r of rows) {
      let obj: AnyRecord = { ...r, _id: r.id };
      if (incl) {
        const keep = new Set([...incl, 'id', '_id']);
        obj = Object.fromEntries(Object.entries(obj).filter(([k]) => keep.has(k)));
      }
      byId.set(r.id, obj);
    }

    if (spec.populate) {
      await applyPopulate(refTable, Array.from(byId.values()), [spec.populate]);
    }

    for (const d of docs) {
      const v = d[spec.path];
      if (typeof v === 'string') d[spec.path] = byId.get(v) ?? null;
      else if (Array.isArray(v))
        d[spec.path] = v.map((x) => (typeof x === 'string' ? byId.get(x) ?? x : x));
    }
  }
}

// ---------------------------------------------------------------------------
// Документ
// ---------------------------------------------------------------------------
/**
 * Маппинг входных данных в значения колонок: берём только реальные колонки и
 * приводим строки/числа к Date для timestamp-колонок. Экспортируется для тестов.
 */
export function toColumnValues(model: ModelRef, src: AnyRecord): AnyRecord {
  const values: AnyRecord = {};
  for (const key of model.colKeys) {
    if (!(key in src) || src[key] === undefined) continue;
    let v = src[key];
    // Drizzle timestamp(mode:'date') ждёт объект Date, но из JSON (форма/API)
    // даты часто приходят ISO-строкой/числом → .toISOString() падает (500).
    // Приводим к Date; невалидные значения пропускаем.
    if (v !== null && (model.columns[key] as any)?.dataType === 'date' && !(v instanceof Date)) {
      const d = new Date(v as string | number);
      if (!Number.isNaN(d.getTime())) v = d;
      else continue;
    }
    values[key] = v;
  }
  return values;
}

async function saveDoc(model: ModelRef, doc: any): Promise<any> {
  const isNew = doc.__isNew === true;
  if (model.config.preSave) await model.config.preSave(doc, isNew);
  const values = toColumnValues(model, doc);
  if (isNew) {
    if (values.id == null) values.id = genObjectId();
    doc.id = values.id;
    doc._id = values.id;
    await db.insert(model.table).values(values);
    doc.__isNew = false;
  } else {
    const { id, ...rest } = values;
    await db.update(model.table).set(rest).where(eq(model.table.id, doc.id));
  }
  return doc;
}

function makeDoc(model: ModelRef, data: AnyRecord, isNew: boolean): any {
  const doc: AnyRecord = {};
  for (const k of Object.keys(data)) {
    if (k === '_id') {
      doc.id = data._id;
      continue;
    }
    doc[k] = data[k];
  }
  if (doc.id != null) doc._id = doc.id;

  const hidden: PropertyDescriptor = { enumerable: false, writable: true, configurable: true };
  Object.defineProperty(doc, '__isNew', { ...hidden, value: isNew });
  Object.defineProperty(doc, '__model', { ...hidden, value: model });
  Object.defineProperty(doc, 'save', { ...hidden, value: function () { return saveDoc(model, this); } });
  Object.defineProperty(doc, 'populate', {
    ...hidden,
    value: async function (arg: string | AnyRecord, fields?: string) {
      await applyPopulate(model.table, [this], [normPop(arg, fields)]);
      return this;
    },
  });
  Object.defineProperty(doc, 'toObject', {
    ...hidden,
    value: function () {
      const o: AnyRecord = {};
      for (const k of Object.keys(this)) o[k] = this[k];
      return o;
    },
  });
  Object.defineProperty(doc, 'toJSON', { ...hidden, value: function () { return this.toObject(); } });
  for (const [name, fn] of Object.entries(model.config.methods || {})) {
    Object.defineProperty(doc, name, { ...hidden, value: fn });
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Query builders (thenable)
// ---------------------------------------------------------------------------
class FindQuery<T = any> implements PromiseLike<T[]> {
  private _sort?: Record<string, 1 | -1>;
  private _limit?: number;
  private _offset?: number;
  private _select?: string;
  private _lean = false;
  private _pops: PopSpec[] = [];

  constructor(private model: ModelRef, private query: AnyRecord = {}) {}

  sort(s: Record<string, 1 | -1>) { this._sort = s; return this; }
  limit(n: number) { this._limit = n; return this; }
  skip(n: number) { this._offset = n; return this; }
  select(s: string) { this._select = s; return this; }
  lean() { this._lean = true; return this; }
  session() { return this; }
  populate(arg: string | AnyRecord, fields?: string) { this._pops.push(normPop(arg, fields)); return this; }
  exec() { return this._run(); }

  private async _run(): Promise<T[]> {
    let q: any = db.select().from(this.model.table);
    const where = buildWhere(this.model, this.query);
    if (where) q = q.where(where);
    const ob = buildOrderBy(this.model, this._sort);
    if (ob.length) q = q.orderBy(...ob);
    if (this._limit != null) q = q.limit(this._limit);
    if (this._offset != null) q = q.offset(this._offset);
    const rows: AnyRecord[] = await q;
    const out = rows.map((r) => {
      const proj = project(this.model, r, this._select);
      return this._lean ? proj : makeDoc(this.model, proj, false);
    });
    if (this._pops.length) await applyPopulate(this.model.table, out, this._pops);
    return out as T[];
  }

  then<R1 = T[], R2 = never>(
    onF?: ((v: T[]) => R1 | PromiseLike<R1>) | null,
    onR?: ((r: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this._run().then(onF, onR);
  }
  catch(onR: (r: any) => any) { return this._run().catch(onR); }
}

class SingleQuery<T = any> implements PromiseLike<T | null> {
  private _select?: string;
  private _lean = false;
  private _pops: PopSpec[] = [];
  private _sort?: Record<string, 1 | -1>;

  constructor(private model: ModelRef, private query: AnyRecord = {}) {}

  select(s: string) { this._select = s; return this; }
  lean() { this._lean = true; return this; }
  session() { return this; }
  sort(s: Record<string, 1 | -1>) { this._sort = s; return this; }
  populate(arg: string | AnyRecord, fields?: string) { this._pops.push(normPop(arg, fields)); return this; }
  exec() { return this._run(); }

  private async _run(): Promise<T | null> {
    let q: any = db.select().from(this.model.table);
    const where = buildWhere(this.model, this.query);
    if (where) q = q.where(where);
    const ob = buildOrderBy(this.model, this._sort);
    if (ob.length) q = q.orderBy(...ob);
    q = q.limit(1);
    const rows: AnyRecord[] = await q;
    if (rows.length === 0) return null;
    const projected = project(this.model, rows[0], this._select);
    const out = this._lean ? projected : makeDoc(this.model, projected, false);
    if (this._pops.length) await applyPopulate(this.model.table, [out], this._pops);
    return out as T;
  }

  then<R1 = T | null, R2 = never>(
    onF?: ((v: T | null) => R1 | PromiseLike<R1>) | null,
    onR?: ((r: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this._run().then(onF, onR);
  }
  catch(onR: (r: any) => any) { return this._run().catch(onR); }
}

/** Результат мутации (findByIdAndUpdate/Delete/findOneAndUpdate) — thenable + populate. */
class DocResult<T = any> implements PromiseLike<T | null> {
  private _pops: PopSpec[] = [];
  private _lean = false;
  private _select?: string;

  constructor(private model: ModelRef, private producer: () => Promise<AnyRecord | null>) {}

  populate(arg: string | AnyRecord, fields?: string) { this._pops.push(normPop(arg, fields)); return this; }
  select(s: string) { this._select = s; return this; }
  lean() { this._lean = true; return this; }
  session() { return this; }
  exec() { return this._run(); }

  private async _run(): Promise<T | null> {
    const row = await this.producer();
    if (!row) return null;
    const projected = project(this.model, row, this._select);
    const out = this._lean ? projected : makeDoc(this.model, projected, false);
    if (this._pops.length) await applyPopulate(this.model.table, [out], this._pops);
    return out as T;
  }

  then<R1 = T | null, R2 = never>(
    onF?: ((v: T | null) => R1 | PromiseLike<R1>) | null,
    onR?: ((r: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this._run().then(onF, onR);
  }
  catch(onR: (r: any) => any) { return this._run().catch(onR); }
}

// ---------------------------------------------------------------------------
// Update helpers
// ---------------------------------------------------------------------------
function buildSetValues(model: ModelRef, update: AnyRecord): AnyRecord {
  const data: AnyRecord = {};
  if (update.$set) Object.assign(data, update.$set);
  for (const k of Object.keys(update)) if (!k.startsWith('$')) data[k] = update[k];
  const values = toColumnValues(model, data);
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) {
      const col = colFor(model, k);
      if (col) values[k] = sql`${col} + ${v}`;
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// Фабрика модели
// ---------------------------------------------------------------------------
export interface CompatModel<T = any> {
  (data?: AnyRecord): any;
  new (data?: AnyRecord): any;
  table: AnyTable;
  config: ModelConfig;
  find(query?: AnyRecord): FindQuery<T>;
  findOne(query?: AnyRecord): SingleQuery<T>;
  findById(id: string): SingleQuery<T>;
  create(data: AnyRecord): Promise<any>;
  insertMany(arr: AnyRecord[]): Promise<any[]>;
  countDocuments(query?: AnyRecord): Promise<number>;
  distinct(field: string, query?: AnyRecord): Promise<any[]>;
  findByIdAndUpdate(id: string, update: AnyRecord, opts?: AnyRecord): DocResult<T>;
  findOneAndUpdate(query: AnyRecord, update: AnyRecord, opts?: AnyRecord): DocResult<T>;
  findByIdAndDelete(id: string): DocResult<T>;
  deleteMany(query?: AnyRecord): Promise<{ deletedCount: number }>;
  updateMany(query: AnyRecord, update: AnyRecord): Promise<{ modifiedCount: number }>;
}

export function createModel<T = any>(table: AnyTable, config: ModelConfig = {}): CompatModel<T> {
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const model: ModelRef = { table, columns, colKeys: Object.keys(columns), config };
  if (config.populate) POPULATE_REGISTRY.set(table, config.populate);

  function Model(this: any, data: AnyRecord = {}) {
    return makeDoc(model, { ...data }, true);
  }

  const M = Model as unknown as CompatModel<T>;
  M.table = table;
  M.config = config;

  M.find = (query = {}) => new FindQuery<T>(model, query);
  M.findOne = (query = {}) => new SingleQuery<T>(model, query);
  M.findById = (id: string) => new SingleQuery<T>(model, { _id: id });

  M.create = async (data: AnyRecord) => saveDoc(model, makeDoc(model, { ...data }, true));

  M.insertMany = async (arr: AnyRecord[]) => {
    if (!arr.length) return [];
    const values = arr.map((d) => {
      const v = toColumnValues(model, d);
      if (v.id == null) v.id = genObjectId();
      return v;
    });
    await db.insert(table).values(values);
    return values.map((v) => makeDoc(model, v, false));
  };

  M.countDocuments = async (query = {}) => {
    let q: any = db.select({ c: sql<number>`count(*)::int` }).from(table);
    const where = buildWhere(model, query);
    if (where) q = q.where(where);
    const rows = await q;
    return rows[0]?.c ?? 0;
  };

  M.distinct = async (field: string, query = {}) => {
    const col = colFor(model, field);
    if (!col) return [];
    let q: any = db.selectDistinct({ v: col }).from(table);
    const where = buildWhere(model, query);
    if (where) q = q.where(where);
    const rows: AnyRecord[] = await q;
    return rows.map((r) => r.v).filter((v) => v != null);
  };

  M.findByIdAndUpdate = (id: string, update: AnyRecord) =>
    new DocResult<T>(model, async () => {
      const values = buildSetValues(model, update);
      const rows = await db.update(table).set(values).where(eq(table.id, id)).returning();
      return rows[0] ?? null;
    });

  M.findOneAndUpdate = (query: AnyRecord, update: AnyRecord, opts: AnyRecord = {}) =>
    new DocResult<T>(model, async () => {
      const where = buildWhere(model, query);
      const values = buildSetValues(model, update);
      const rows = where ? await db.update(table).set(values).where(where).returning() : [];
      if (rows.length) return rows[0];
      if (opts.upsert) {
        const insertData: AnyRecord = {};
        for (const [k, v] of Object.entries(query)) if (!k.startsWith('$')) insertData[k] = v;
        Object.assign(insertData, update.$set || {});
        for (const k of Object.keys(update)) if (!k.startsWith('$')) insertData[k] = update[k];
        const created = await saveDoc(model, makeDoc(model, insertData, true));
        return created;
      }
      return null;
    });

  M.findByIdAndDelete = (id: string) =>
    new DocResult<T>(model, async () => {
      const rows = await db.delete(table).where(eq(table.id, id)).returning();
      return rows[0] ?? null;
    });

  M.deleteMany = async (query = {}) => {
    const where = buildWhere(model, query);
    const rows = where
      ? await db.delete(table).where(where).returning({ id: table.id })
      : await db.delete(table).returning({ id: table.id });
    return { deletedCount: rows.length };
  };

  M.updateMany = async (query: AnyRecord, update: AnyRecord) => {
    const where = buildWhere(model, query);
    const values = buildSetValues(model, update);
    const rows = where
      ? await db.update(table).set(values).where(where).returning({ id: table.id })
      : await db.update(table).set(values).returning({ id: table.id });
    return { modifiedCount: rows.length };
  };

  return M;
}
