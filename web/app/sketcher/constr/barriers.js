import { sq } from "math/commons";


/**
 * 创建一个约束函数，用于惩罚小于给定阈值的值。
 *
 * @param {number} val - 阈值。
 * @returns {Object} 一个包含两个函数的对象：
 *   - d0: 计算给定值的惩罚的函数。
 *   - d1: 计算给定值的惩罚的导数的函数。
 */
export function greaterThanConstraint(val)
{
  const K = 100;
  return {
    d0: x => K * sq(Math.min(0, x - val)),
    d1: x => x < val ? K * (2 * x - 2 * val) : 0
  }
}


/**
 * 创建一个约束函数，用于惩罚大于给定阈值的值。
 *
 * @param {number} val - 阈值。
 * @returns {Object} 一个包含两个函数的对象：
 *   - d0: 计算给定值的惩罚的函数。
 *   - d1: 计算给定值的惩罚的导数的函数。
 */
export function lessThanConstraint(val)
{
  const K = 100;
  return {
    d0: x => K * sq(Math.max(0, x - val)),
    d1: x => x <= val ? 0 : K * (2 * x - 2 * val)
  }
}
