/**
 * Return this from a handler to put `meta` (for example pagination) next to `data`
 * in the success envelope: `return new WithMeta(rows, { page, pageSize, total })`.
 */
export class WithMeta<T, M extends Record<string, unknown> = Record<string, unknown>> {
  constructor(
    readonly data: T,
    readonly meta: M,
  ) {}
}
