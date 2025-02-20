import { Generator } from "../id-generator";
import { SolverParam } from "../constr/solverParam";

/**
 * 表示具有相关值和求解器参数的参数。
 *
 * @class Param
 * @property {number} id - 参数的唯一标识符。
 * @property {number} value - 参数的值。
 * @property {SolverParam} solverParam - 与此参数关联的求解器参数。
 * @property {string} debugSymbol - 用于调试的符号。
 * @property {(number) => any} normalizer - 用于规范化参数值的函数。
 * @property {boolean} enforceVisualLimit - 指示是否强制执行视觉限制的标志。
 * @property {any[]} [constraints] - 可选的惩罚函数约束数组。
 *
 * @constructor
 * @param {number} value - 参数的初始值。
 * @param {string} debugSymbol - 参数的调试符号。
 *
 * @method set
 * @param {number} value - 设置参数的值。
 *
 * @method get
 * @returns {number} - 获取参数的值。
 *
 * @method toString
 * @returns {string} - 返回参数的字符串表示形式。
 *
 * @method visitParams
 * @param {Function} callback - 访问参数的回调函数。
 */
export class Param {

  id: number;
  value: number;
  solverParam: SolverParam;
  readonly debugSymbol: string;
  normalizer: (number: number) => number;
  enforceVisualLimit: boolean = false;

  //penalty function constraints
  constraints?: any[];

  constructor(value: number, debugSymbol = 'X') {
    this.id = Generator.genID();
    this.value = value;
    this.solverParam = new SolverParam(value, this);
    this.debugSymbol = debugSymbol || 'X';
  }

  set(value: number) {
    this.value = value;
  }

  get() {
    return this.value;
  }

  toString() {
    return this.debugSymbol + this.id;
  }

  visitParams(callback: (param: Param) => void) {
    callback(this);
  }

}
