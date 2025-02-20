import { eqEps } from "geom/tolerance";
import { compositeFn } from "gems/func";
import { SolverParam } from "./solverParam";
import { Param } from "../shapes/param";

// Polynomial 类表示一个多项式
export class Polynomial {

  monomials: Monomial[] = []; // 存储多项式中的单项式
  constant = 0; // 多项式的常数项

  constructor(constant = 0) {
    this.constant = constant;
  }

  // 获取最后一个单项式
  get lastMonomial() {
    return this.monomials[this.monomials.length - 1];
  }

  // 向最后一个单项式添加一个项
  term(p: Param, fn: any) {
    this.lastMonomial.addParam(p, fn);
    return this;
  }

  // 添加一个新的单项式
  monomial(k = 1) {
    this.monomials.push(new Monomial(k));
    return this;
  }

  // 消去指定参数的项
  eliminate(param: Param, value: number) {
    let touched = false;
    for (const m of this.monomials)
    {
      for (let i = 0; i < m.terms.length; ++i)
      {
        if (m.terms[i].param === param)
        {
          m.eliminate(i, value);
          touched = true;
        }
      }
    }
    return touched;
  }

  // 替换指定参数
  substitute(param: Param, toParam: Param, dotConstant: number) {
    for (const m of this.monomials)
    {
      let touched = false;
      for (let i = 0; i < m.terms.length; ++i)
      {
        if (m.terms[i].param === param)
        {
          m.substitute(i, toParam, dotConstant);
          touched = true;
        }
      }
      if (touched)
      {
        m.mergeTerms();
      }
    }
  }

  // 线性替换指定参数
  linearSubstitution(param: Param, toParam: Param, k: number, b: number) {
    const transaction = compositeFn();
    for (let mi = this.monomials.length - 1; mi >= 0; --mi)
    {
      const m = this.monomials[mi];
      for (let i = 0; i < m.terms.length; ++i)
      {
        if (m.terms[i].param === param)
        {
          const polynomial = m.terms[i].fn.linearSubstitution(k, toParam, b);
          if (polynomial)
          {
            transaction.push(() => {
              for (let k = 0; k < polynomial.monomials.length; ++k)
              {
                const monomialToExpand = polynomial.monomials[k];
                this.monomial(monomialToExpand.constant * m.constant);
                this.lastMonomial.terms = monomialToExpand.terms.slice();

                for (const termToJoin of m.terms)
                {
                  if (termToJoin !== m.terms[i])
                  {
                    this.lastMonomial.terms.push({ ...termToJoin });
                  }
                }
                this.lastMonomial.sort();
              }
              m.constant *= polynomial.constant;
              m.terms.splice(i, 1);
            });
          } else
          {
            return null;
          }
        }
      }
    }
    return transaction;
  }

  // 压缩多项式，合并相同变量的项
  compact() {
    for (let i = 0; i < this.monomials.length; ++i)
    {
      const m1 = this.monomials[i];
      if (m1 === null)
      {
        continue;
      }
      for (let j = i + 1; j < this.monomials.length; ++j)
      {
        const m2 = this.monomials[j];
        if (m2 === null)
        {
          continue;
        }

        if (m1.equalVars(m2))
        {
          m1.constant += m2.constant;
          this.monomials[j] = null;
        }
      }
      if (eqEps(m1.constant, 0))
      {
        this.monomials[i] = null;
      } else if (m1.terms.length === 0)
      {
        this.constant += m1.constant;
        this.monomials[i] = null;
      }
    }
    this.monomials = this.monomials.filter(m => m !== null);
  }

  // 判断多项式是否为线性的
  get isLinear() {
    for (const m of this.monomials)
    {
      if (m.terms.length !== 1 || m.terms[0].fn.degree !== 1)
      {
        return false;
      }
    }
    return true;
  }

  // 计算多项式的值
  value(valueFn = GET_VALUE) {
    let res = this.constant;
    for (const m of this.monomials)
    {
      res += m.value(valueFn);
    }
    return res;
  }

  // 将多项式转换为残差形式
  asResidual() {

    const paramsSet: Set<SolverParam> = new Set();

    for (const m of this.monomials)
    {
      for (const t of m.terms)
      {
        paramsSet.add(t.param.solverParam);
      }
    }

    const params = Array.from(paramsSet);

    const solverValue = p => p.solverParam.get();

    return {

      params,

      error: () => this.value(solverValue),

      gradient: out => {

        for (let i = 0; i < params.length; i++)
        {

          out[i] = 0;

          for (const m of this.monomials)
          {
            out[i] += m.differentiate(params[i].objectParam, solverValue);
          }
        }

      },

    };


  }

  // 遍历多项式中的参数
  visitParams(callback: (param: any) => void) {
    for (const m of this.monomials)
    {
      for (const t of m.terms)
      {
        callback(t.param);
      }
    }
  }

  // 将多项式转换为字符串
  toString() {

    return this.monomials.map(m => {

      let out = '';
      if (m.constant === 1)
      {
        out += '+';
      } else if (m.constant === -1)
      {
        out += '-';
      } else
      {
        out += (m.constant >= 0 ? '+' : '') + m.constant.toFixed(2);
        if (m.terms.length)
        {
          out += '*';
        }
      }

      out += m.terms.map(t => {
        let out = t.param.debugSymbol + t.param.id;
        if (t.fn.degree === 1)
        {

        } else if (t.fn.degree !== Infinity)
        {
          out += t.fn.id;
        } else if (t.fn.render)
        {
          out = t.fn.render(out);
        } else
        {
          out = t.fn.id + '(' + out + ')';
        }
        return out;
      }).join('*');

      return out;
    }
    ).join(' ') + (this.constant >= 0 ? ' + ' : ' ') + this.constant.toFixed(2);

  }

}

// Monomial 类表示一个单项式
export class Monomial {

  terms: { param: Param, fn: any }[] = []; // 存储单项式中的项
  constant = 1; // 单项式的常数项

  constructor(constant = 1) {
    this.constant = constant;
  }

  // 获取线性参数
  get linearParam() {
    return this.terms[0].param;
  }

  // 向单项式添加一个项
  addParam(param: Param, fn: any) {
    this.terms.push({ param, fn });
    this.sort();
  }

  // 对单项式中的项进行排序
  sort() {
    this.terms.sort(t => t.param.id);
  }

  // 消去指定索引的项
  eliminate(i: number, value: number) {
    const fn = this.terms[i].fn;
    this.constant *= fn.apply(value);
    this.terms.splice(i, 1);
  }

  // 替换指定索引的项
  substitute(index: number, toParam: Param, dotConstant: number) {
    this.terms[index].param = toParam;
    this.constant *= dotConstant;
  }

  // 合并相同参数的项
  mergeTerms() {
    let wasMerge = false;
    for (let i = 0; i < this.terms.length; ++i)
    {
      const merger = this.terms[i];
      if (!merger)
      {
        continue;
      }
      for (let j = i + 1; j < this.terms.length; ++j)
      {
        const term = this.terms[j];
        if (merger.param === term.param)
        {
          const mergedFn = merger.fn.merge(term.fn);
          if (mergedFn)
          {
            merger.fn = mergedFn;
            this.terms[j] = null;
            wasMerge = true;
          }
        }
      }
    }
    if (wasMerge)
    {
      this.terms = this.terms.filter(t => t);
    }
  }

  // 判断两个单项式是否具有相同的变量
  equalVars(other: Monomial) {
    if (this.terms.length !== other.terms.length)
    {
      return false;
    }

    for (let i = 0; i < this.terms.length; ++i)
    {
      const t1 = this.terms[i];
      const t2 = other.terms[i];
      if (t1.fn.id !== t2.fn.id || t1.param.id !== t2.param.id)
      {
        return false;
      }
    }
    return true;
  }

  // 计算单项式对指定参数的偏导数
  differentiate(partialParam: Param, valueFn = GET_VALUE) {

    let cnst = this.constant;

    let diffProduct = 0;
    let freeProduct = 1;

    for (const term of this.terms)
    {
      const pVal = valueFn(term.param);
      const d0 = term.fn.apply(pVal);
      if (partialParam === term.param)
      {
        const d1 = term.fn.derivative1(pVal);
        diffProduct = diffProduct * d0 + freeProduct * d1;
        freeProduct *= d0;
      } else
      {
        cnst *= d0;
      }
    }

    return cnst * diffProduct;
  }

  // 计算单项式的值
  value(valueFn: (param: Param) => number) {
    let res = this.constant;
    for (const t of this.terms)
    {
      res *= t.fn.apply(valueFn(t.param));
    }
    return res;
  }
}

// 抽象类 PolynomialFunction 表示多项式函数
export abstract class PolynomialFunction {

  id: string;
  abstract get degree(): number;
  abstract apply(x: number): number;
  abstract merge(fn: PolynomialFunction): PolynomialFunction;
  abstract derivative1(x: number): number
}

// ToThePowerFunction 类表示幂函数
export class ToThePowerFunction extends PolynomialFunction {

  static get(degree) {
    switch (degree)
    {
      case 0: return POW_0_FN;
      case 1: return POW_1_FN;
      case 2: return POW_2_FN;
      case 3: return POW_3_FN;
      case 4: return POW_4_FN;
      default: return new ToThePowerFunction(degree,
        x => {
          let val = 1;
          for (let i = 0; i < degree; ++i)
          {
            val *= x;
          }
          return val
        },
        x => {
          let val = 1;
          for (let i = 0; i < degree - 1; ++i)
          {
            val *= x;
          }
          return degree * val
        }
      )
    }
  }

  _degree: number;
  fn: (number) => number;
  d1: (number) => number;

  constructor(degree, fn, d1) {
    super();
    this._degree = degree;
    this.fn = fn;
    this.d1 = d1;
    this.id = '^' + degree;
  }

  get degree() {
    return this._degree;
  }

  apply(x) {
    return this.fn(x);
  }

  merge(fn) {
    if (fn.constructor.name === this.constructor.name)
    {
      return ToThePowerFunction.get(fn.degree + this.degree);
    }
    return null;
  }

  derivative1(x) {
    return this.d1(x)
  }

  linearSubstitution(k, x, b) {
    if (this.degree === 1)
    {
      return new Polynomial(b).monomial(k).term(x, POW_1_FN);
    } else if (this.degree === 2)
    {
      return new Polynomial(b * b).monomial(k * k).term(x, POW_2_FN).monomial(2 * k * b).term(x, POW_1_FN);
    } else
    {
      return null;
    }
  }

}

// FreeFunction 类表示自由函数
export class FreeFunction extends PolynomialFunction {

  fn: (number) => number;
  d1: (number) => number;
  linearSubstitutionFn: (k: number, param: any, b: number) => Polynomial;

  constructor(fn, d1, id, linearSubstitutionFn) {
    super();
    this.fn = fn;
    this.d1 = d1;
    this.id = id;
    this.linearSubstitutionFn = linearSubstitutionFn || null;
  }

  apply(x) {
    return this.fn(x);
  }

  get degree() {
    return Infinity;
  }

  merge(fn) {
    return null;
  }

  derivative1(x) {
    return this.d1(x)
  }

  linearSubstitution(k, x, b) {
    return this.linearSubstitutionFn(k, x, b);
  }

}

// CosineOfSum 类表示和的余弦函数
export class CosineOfSum extends PolynomialFunction {

  k: number;
  b: number;

  constructor(k, b) {
    super();
    this.k = k;
    this.b = b;
    this.id = 'cos(' + k + 'x + ' + b + ')';
  }

  apply(x) {
    return Math.cos(this.k * x + this.b);
  }

  get degree() {
    return Infinity;
  }

  merge(fn) {
    return null;
  }

  derivative1(x) {
    return - this.k * Math.sin(this.k * x + this.b);
  }

  linearSubstitution(k, x, b) {
    return new Polynomial(0).monomial(1).term(x, new CosineOfSum(this.k * k, this.k * b + this.b));
  }

  render(x) {
    return 'cos(' + this.k.toFixed(2) + '*' + x + ' + ' + this.b.toFixed(2) + ')';
  }

}

// SineOfSum 类表示和的正弦函数
export class SineOfSum extends PolynomialFunction {

  k: number;
  b: number;

  constructor(k: number, b: number) {
    super();
    this.k = k;
    this.b = b;
    this.id = 'sin(' + k + 'x + ' + b + ')';
  }

  apply(x: number) {
    return Math.sin(this.k * x + this.b);
  }

  get degree() {
    return Infinity;
  }

  merge(fn) {
    return null;
  }

  derivative1(x: number) {
    return this.k * Math.cos(this.k * x + this.b);
  }

  linearSubstitution(k: number, x: Param, b: number) {
    return new Polynomial(0).monomial(1).term(x, new SineOfSum(this.k * k, this.k * b + this.b));
  }

  render(x: number) {
    return 'sin(' + this.k.toFixed(2) + '*' + x + ' + ' + this.b.toFixed(2) + ')';
  }
}

// 获取参数值的函数
const GET_VALUE = param => param.get();

// 预定义的幂函数
export const POW_0_FN = new ToThePowerFunction(0, x => 1, x => 0);
export const POW_1_FN = new ToThePowerFunction(1, x => x, x => 1);
export const POW_2_FN = new ToThePowerFunction(2, x => x * x, x => 2 * x);
export const POW_3_FN = new ToThePowerFunction(3, x => x * x * x, x => 3 * x * x);
export const POW_4_FN = new ToThePowerFunction(3, x => x * x * x * x, x => 4 * x * x * x);

// 预定义的三角函数
export const COS_FN = new FreeFunction(x => Math.cos(x), x => -Math.sin(x), 'cos', (k, x, b) => new Polynomial(0).monomial(1).term(x, new CosineOfSum(k, b)));
export const SIN_FN = new FreeFunction(x => Math.sin(x), x => Math.cos(x), 'sin', (k, x, b) => new Polynomial(0).monomial(1).term(x, new SineOfSum(k, b)));
