import { toRefs } from '../observer/ref'

/**
 * * @description: all the props extracted are reactive
 * * @param: store
 * @return {*} store
 */
export function storeToRefs (store) {
  return toRefs(store)
}
