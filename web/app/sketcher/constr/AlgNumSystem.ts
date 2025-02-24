import { prepare } from "./solver";
import { eqEps } from "geom/tolerance";
import { Polynomial, POW_1_FN } from "./polynomial";
import { compositeFn } from "gems/func";
import { AlgNumConstraint } from "./ANConstraints";
import { SolverParam } from "./solverParam";
import { SolveStage } from "../parametric";
import { Param } from "../shapes/param";
import { SketchObject } from "../shapes/sketch-object";

const DEBUG = false;

/**
 * 代数数值子系统类
 * 用于处理和求解几何约束系统
 */
export class AlgNumSubSystem {
  /** 所有约束的数组 */
  allConstraints: AlgNumConstraint[] = [];

  /** 参数到隔离的映射 */
  paramToIsolation: Map<Param, Isolation> = new Map();

  /** 已消除参数的映射 */
  eliminatedParams: Map<Param, number> = new Map();

  /** 多项式数组 */
  polynomials: Polynomial[] = [];

  /** 已替换参数的映射 */
  substitutedParams: Map<Param, Polynomial> = new Map();

  /** 替换顺序数组 */
  substitutionOrder: Param[] = [];

  /** 多项式到约束的映射 */
  polyToConstr: Map<Polynomial, AlgNumConstraint> = new Map();

  /** 冲突约束集合 */
  conflicting: Set<AlgNumConstraint> = new Set();

  /** 冗余约束集合 */
  redundant: Set<AlgNumConstraint> = new Set();

  /** 交互参数集合 */
  interactiveParams: Set<Param> = new Set();

  /** 是否启用控制边界 */
  controlBounds: boolean = false;

  /** 快照映射 */
  snapshot: Map<Param, number> = new Map();

  /** 是否在事务中 */
  inTransaction: boolean = false;

  /** 可视限制 */
  visualLimit: number = 100;

  /** 舞台对象 */
  stage: SolveStage;

  /** 自由度 */
  dof: number = 0;

  /** 是否需要进行硬求解 */
  requiresHardSolve: boolean = false;

  /** 多项式隔离数组 */
  polynomialIsolations: Isolation[];

  /** 计算可视限制的函数 */
  calcVisualLimit: () => number;

  /** 表达式解析器函数 */
  expressionResolver: (string) => any;

  /** 求解状态 */
  solveStatus: SolveStatus;

  /**
   * 构造函数
   * @param calcVisualLimit - 计算可视限制的函数
   * @param expressionResolver - 表达式解析器函数
   * @param stage - 舞台对象
   */
  constructor(calcVisualLimit: () => number, expressionResolver: (string) => any, stage: SolveStage) {

    this.calcVisualLimit = calcVisualLimit;
    this.expressionResolver = expressionResolver;
    this.stage = stage;

    this.solveStatus = {
      error: 0,
      success: true
    }

  }

  /**
   * 获取当前系统拥有的顶层对象
   * @returns 系统的对象数组
   */
  get ownTopObjects() {
    return this.stage.objects;
  }

  get fullyConstrained() {
    return this.dof === 0;
  }

  /**
   * 检查对象是否属于当前系统
   * @param obj - 要检查的对象
   * @returns 如果对象属于当前系统返回true
   */
  owns(obj: SketchObject) {
    return this.stage === obj.stage;
  }

  /**
   * 遍历有效约束
   * @param callback - 回调函数
   */
  validConstraints(callback: (c: AlgNumConstraint) => void) {
    this.allConstraints.forEach(c => {
      if (!this.conflicting.has(c))
      {
        callback(c);
      }
    });
  }

  /**
   * 添加新的约束
   * @param constraint - 要添加的约束对象
   */
  addConstraint(constraint: AlgNumConstraint) {

    if (this.inTransaction)
    {
      constraint.objects.forEach(o => o.constraints.add(constraint));
      this.allConstraints.push(constraint);
      return;
    }

    this.makeSnapshot();

    this.allConstraints.push(constraint);

    this.prepare();
    if (!this.isConflicting(constraint))
    {
      this.solveFine();
      if (!this.solveStatus.success)
      {
        console.log("adding to conflicts");
        this.conflicting.add(constraint);
      }
    }

    if (this.isConflicting(constraint))
    {
      this.rollback();
      // } else if (this.fullyConstrained) {
      //   this.rollback();
      //   this.conflicting.add(constraint);
      //   this.redundant.add(constraint);
    } else
    {
      constraint.objects.forEach(o => o.constraints.add(constraint));
      this.updateFullyConstrainedObjects();
    }
  }

  /**
   * 重新验证约束
   * @param constraint - 要重新验证的约束对象
   */
  revalidateConstraint(constraint) {
    this.conflicting.delete(constraint);
    this.redundant.delete(constraint);
  }

  /**
   * 开始事务
   */
  startTransaction() {
    this.inTransaction = true;
  }

  /**
   * 结束事务
   */
  finishTransaction() {
    this.inTransaction = false;
    this.prepare();
    this.updateFullyConstrainedObjects();
  }


  /**
   * 使系统失效
   */
  invalidate() {
    this.prepare();
    this.solveFine();
    this.updateFullyConstrainedObjects();
  }

  /**
   * 移除约束
   * @param constraint - 要移除的约束对象
   */
  removeConstraint(constraint) {
    this._removeConstraint(constraint);
    this.invalidate();
  }

  /**
   * 移除约束
   * @param constraint - 要移除的约束对象
   */
  _removeConstraint(constraint) {
    const index = this.allConstraints.indexOf(constraint);
    if (index !== -1)
    {
      this.allConstraints.splice(index, 1);
      this.conflicting.delete(constraint);
      this.redundant.delete(constraint);
      constraint.objects.forEach(o => o.constraints.delete(constraint));
    }
  }

  /**
   * 检查约束是否冲突
   * @param constraint - 要检查的约束对象
   * @returns 如果约束冲突返回true
   */
  isConflicting(constraint: AlgNumConstraint) {
    return this.conflicting.has(constraint);
  }

  /**
   * 创建快照
   */
  makeSnapshot() {
    this.snapshot.clear();
    this.validConstraints(c => c.params.forEach(p => this.snapshot.set(p, p.get())));
  }

  /**
   * 回滚到快照
   */
  rollback() {
    this.snapshot.forEach((val, param) => param.set(val));
  }

  /**
   * 重置系统
   */
  reset() {
    this.polyToConstr.clear();
    this.interactiveParams.clear();
    this.requiresHardSolve = false;
  }

  /**
   * 评估多项式
   */
  evaluatePolynomials() {

    this.validConstraints(c => {
      let i = this.polynomials.length;
      c.collectPolynomials(this.polynomials);
      for (; i < this.polynomials.length; i++)
      {
        const polynomial = this.polynomials[i];
        this.polyToConstr.set(polynomial, c);

        c.objects.forEach(obj => {
          if (!this.owns(obj))
          {
            obj.visitParams(p => {
              polynomial.eliminate(p, p.get());
            });
          }
        });
        polynomial.compact();
      }
    });

    if (DEBUG)
    {
      console.log('reducing system(of', this.polynomials.length, '):');
      this.polynomials.forEach(p => console.log(p.toString()));
    }

    let requirePass = true;

    while (requirePass)
    {
      requirePass = false;
      for (let i = 0; i < this.polynomials.length; ++i)
      {
        const polynomial = this.polynomials[i];
        if (!polynomial)
        {
          continue;
        }

        if (polynomial.monomials.length === 0)
        {
          this.conflicting.add(this.polyToConstr.get(polynomial));
          if (DEBUG)
          {
            console.log("CONFLICT: " + polynomial.toString());
          }
          if (eqEps(polynomial.constant, 0))
          {
            this.redundant.add(this.polyToConstr.get(polynomial));
            // console.log("REDUNDANT");
          }
          this.polynomials[i] = null;
        } else if (polynomial.isLinear && polynomial.monomials.length === 1)
        {
          this.polynomials[i] = null;
          const monomial = polynomial.monomials[0];
          const terms = monomial.terms;
          if (terms.length === 1)
          {
            const term = terms[0];
            if (term.fn.degree === 1)
            {
              const p = term.param;
              const val = - polynomial.constant / monomial.constant;
              p.set(val);

              this.eliminatedParams.set(p, val);

              for (const otherPolynomial of this.polynomials)
              {
                if (otherPolynomial)
                {
                  otherPolynomial.eliminate(p, val);
                }
              }

              requirePass = true;
            }
          }

        } else if (polynomial.monomials.length === 2 && polynomial.isLinear)
        {
          let [m1, m2] = polynomial.monomials;

          if (this.interactiveParams.has(m1.linearParam))
          {
            const t = m1;
            m1 = m2;
            m2 = t;
          }

          const p1 = m1.linearParam;
          const p2 = m2.linearParam;

          const constant = - m2.constant / m1.constant;
          if (eqEps(polynomial.constant, 0))
          {

            this.polynomials[i] = null;
            this.substitute(p1, new Polynomial().monomial(constant).term(p2, POW_1_FN));
            for (const otherPolynomial of this.polynomials)
            {
              if (otherPolynomial)
              {
                otherPolynomial.substitute(p1, p2, constant);
              }
            }
            requirePass = true;
          } else
          {
            const b = - polynomial.constant / m1.constant;

            let transaction = compositeFn();
            for (const otherPolynomial of this.polynomials)
            {
              if (otherPolynomial && otherPolynomial !== polynomial)
              {
                const polyTransaction = otherPolynomial.linearSubstitution(p1, p2, constant, b);
                if (!polyTransaction)
                {
                  transaction = null;
                  break;
                }
                transaction.push(polyTransaction);
                transaction.push(() => {
                  this.substitute(p1, new Polynomial(b).monomial(constant).term(p2, POW_1_FN));
                  this.polynomials[i] = null;
                });
              }
            }
            if (transaction && transaction.functionList.length !== 0)
            {
              transaction();
              requirePass = true;
            }
          }
        }
      }

      if (requirePass)
      {
        this.polynomials.forEach(polynomial => polynomial && polynomial.compact());
      }
    }


    this.polynomials = this.polynomials.filter(p => p);

  }

  /**
   * 替换参数
   * @param param - 要替换的参数
   * @param overPolynomial - 替换的多项式
   */
  substitute(param, overPolynomial) {
    this.substitutionOrder.push(param);
    this.substitutedParams.set(param, overPolynomial);
  }

  /**
   * 准备求解系统
   * @param interactiveObjects - 交互对象数组
   */
  prepare(interactiveObjects = []) {

    this.reset();
    interactiveObjects.forEach(obj => obj.visitParams(p => this.interactiveParams.add(p)));

    this.validConstraints(c => c.objects.forEach(obj => {
      if (!this.owns(obj))
      {
        this.requiresHardSolve = true;
      }
    }));

    this.validConstraints(c => c.resolveConstants(this.expressionResolver));

    this.evaluateAndBuildSolver();

    this.visualLimit = this.calcVisualLimit();

    if (DEBUG)
    {
      console.log('solving system:');
      this.polynomialIsolations.forEach((iso, i) => {
        console.log(i + ". ISOLATION, DOF: " + iso.dof);
        iso.polynomials.forEach(p => console.log(p.toString()));
      });

      console.log('with respect to:');
      this.substitutionOrder.forEach(x => console.log(x.toString() + ' = ' + this.substitutedParams.get(x).toString()));
    }
  }

  /**
   * 评估并构建求解器
   */
  evaluateAndBuildSolver() {
    this.polynomials = [];
    this.substitutedParams.clear();
    this.substitutionOrder = [];
    this.eliminatedParams.clear();
    this.paramToIsolation.clear();

    this.validConstraints(c => c.params.forEach(p => p.normalizer && p.set(p.normalizer(p.get()))));

    this.evaluatePolynomials();

    this.polynomialIsolations = this.splitByIsolatedClusters(this.polynomials);
    this.polynomialIsolations.forEach(iso => {
      iso.beingSolvedParams.forEach(solverParam => this.paramToIsolation.set(solverParam.objectParam, iso))
    });
  }

  /**
   * 将多项式分割为隔离的簇
   * @param polynomials - 多项式数组
   * @returns 隔离的簇数组
   */
  splitByIsolatedClusters(polynomials: Polynomial[]) {
    const graph = new Map();

    function link(a: Polynomial, b: Polynomial) {
      let list = graph.get(a);
      if (!list)
      {
        list = [];
        graph.set(a, list);
      }
      list.push(b);
    }

    const visited = new Set();

    polynomials.forEach(pl => {
      visited.clear();
      pl.visitParams(p => {
        if (visited.has(p))
        {
          return;
        }
        visited.add(p);
        link(p, pl);
        link(pl, p);
      })
    });

    visited.clear();

    const clusters = [];

    for (const initPl of polynomials)
    {
      if (visited.has(initPl))
      {
        continue
      }
      const stack = [initPl];
      const isolation = [];
      while (stack.length)
      {
        const pl = stack.pop();
        if (visited.has(pl))
        {
          continue;
        }
        isolation.push(pl);
        visited.add(pl);
        const params = graph.get(pl);
        for (const p of params)
        {
          const linkedPolynomials = graph.get(p);
          for (const linkedPolynomial of linkedPolynomials)
          {
            if (linkedPolynomial !== pl)
            {
              stack.push(linkedPolynomial);
            }
          }
        }
      }
      if (isolation.length)
      {
        clusters.push(new Isolation(isolation, this));
      }
    }

    return clusters;
  }

  /**
   * 执行粗略求解
   */
  solveRough() {
    this.solve(true);
  }

  /**
   * 执行精确求解
   */
  solveFine() {
    this.solve(false);
  }

  /**
   * 执行求解
   * @param rough - 是否进行粗略求解
   * AlgNumSubSystem.prototype.solve
   */
  solve(rough: boolean) {

    if (this.requiresHardSolve)
    {
      this.evaluateAndBuildSolver();
    }

    this.polynomialIsolations.forEach(iso => {
      iso.solve(rough);
    });

    if (!rough)
    {

      this.solveStatus.error = 0;
      this.solveStatus.success = true;

      this.polynomialIsolations.forEach(iso => {
        this.solveStatus.error = Math.max(this.solveStatus.error, iso.solveStatus.error);
        this.solveStatus.success = this.solveStatus.success && iso.solveStatus.success;
      });

      if (DEBUG)
      {
        console.log('numerical result: ' + this.solveStatus.success);
      }
    }

    for (const [p, val] of this.eliminatedParams)
    {
      p.set(val);
    }

    for (let i = this.substitutionOrder.length - 1; i >= 0; i--)
    {
      const param = this.substitutionOrder[i];
      const expression = this.substitutedParams.get(param);
      param.set(expression.value());
    }
  }

  /**
   * 更新完全约束对象的状态
   */
  updateFullyConstrainedObjects() {

    this.validConstraints(c => {

      c.objects.forEach(obj => {

        let allLocked = true;

        obj.visitParams(p => {
          if (!this.isParamFullyConstrained(p))
          {
            allLocked = false;
          }
        });

        obj.fullyConstrained = allLocked;
      });
    });
  }

  isParamShallowConstrained(p) {
    const iso = this.paramToIsolation.get(p);
    return this.eliminatedParams.has(p) || (iso && iso.fullyConstrained);
  }

  /**
   * 检查参数是否完全约束
   * @param sourceParam 要检查的参数
   * @returns 如果参数完全约束返回true
   */
  isParamFullyConstrained(sourceParam) {

    const visited = new Set();

    const dfs = param => {
      if (visited.has(param))
      {
        return;
      }
      visited.add(param);
      if (this.isParamShallowConstrained(param))
      {
        return true;
      }
      const substitution = this.substitutedParams.get(param);
      let res = false;
      if (substitution)
      {
        substitution.visitParams(p => {
          if (dfs(p))
          {
            res = true;
          }
        });
      }
      return res;
    };
    return dfs(sourceParam);
  }

}

/**
 * 隔离类
 * 用于处理多项式系统的隔离求解
 */
class Isolation {
  /** 多项式数组 */
  polynomials: Polynomial[];
  /** 系统对象 */
  system: AlgNumSubSystem;
  /** 正在求解的参数集合 */
  beingSolvedParams: Set<SolverParam>;
  /** 正在求解的约束集合 */
  beingSolvedConstraints: Set<AlgNumConstraint>;
  /** 自由度 */
  dof: number;
  /** 求解状态 */
  solveStatus: SolveStatus;
  /** 数值求解器 */
  numericalSolver: { system; diagnose; solveSystem; error; updateLock };

  /**
   * 构造函数
   * @param polynomials - 多项式数组
   * @param system - 系统对象
   */
  constructor(polynomials: Polynomial[], system: AlgNumSubSystem) {
    this.system = system;
    this.polynomials = polynomials;
    this.beingSolvedParams = new Set();
    this.beingSolvedConstraints = new Set();
    const residuals = [];

    this.polynomials.forEach(p => {
      residuals.push(p.asResidual());
      this.beingSolvedConstraints.add(system.polyToConstr.get(p));
    });

    for (const residual of residuals)
    {
      residual.params.forEach(solverParam => {
        if (!this.beingSolvedParams.has(solverParam))
        {
          solverParam.reset(solverParam.objectParam.get());
          this.beingSolvedParams.add(solverParam);
        }
      });
    }
    this.dof = this.beingSolvedParams.size - polynomials.length;
    const penaltyFunction = new PolynomialResidual();
    this.beingSolvedParams.forEach(sp => {
      const param = sp.objectParam;
      if (param.constraints)
      {
        penaltyFunction.add(sp, param.constraints);
      }
    });

    if (penaltyFunction.params.length)
    {
      residuals.push(penaltyFunction);
    }

    this.numericalSolver = prepare(residuals);
  }

  /**
   * 检查隔离是否完全约束
   * @returns 如果隔离完全约束返回true
   */
  get fullyConstrained() {
    return this.dof === 0;
  }

  /**
   * 求解隔离的系统
   * @param rough 是否进行粗略求解
   * Isolation.prototype.solve
   */
  solve(rough: boolean) {

    this.beingSolvedConstraints.forEach(c => c.initialGuess());

    //预先获取所有的变量的值(比如求角度啊 A X Y)
    this.beingSolvedParams.forEach(solverParam => {
      let val = solverParam.objectParam.get();

      if (this.system.controlBounds)
      {
        if (solverParam.objectParam.enforceVisualLimit && val < this.system.visualLimit)
        {
          val = this.system.visualLimit;
        }
      }
      solverParam.set(val);
    });

    //在这里进行求解计算
    this.solveStatus = this.numericalSolver.solveSystem(rough);

    //赋予值
    this.beingSolvedParams.forEach(solverParam => {
      solverParam.objectParam.set(solverParam.get());
    });
  }

}

/**
 * 多项式残差类
 * 用于计算和处理多项式约束的残差
 */
class PolynomialResidual {

  /** 参数数组 */
  params = [];

  /** 函数数组 */
  functions = [];

  /**
   * 添加参数和对应的函数
   * @param param 参数
   * @param fns 函数数组
   */
  add(param, fns) {
    this.params.push(param);
    this.functions.push(fns);
  }

  /**
   * 计算误差
   * @returns 计算得到的误差值
   */
  error() {
    let err = 0;
    for (let i = 0; i < this.params.length; ++i)
    {
      const val = this.params[i].get();
      const paramFunctions = this.functions[i];
      for (const fn of paramFunctions)
      {
        const d0 = fn.d0(val);
        err += d0;// * d0;
      }
    }

    return err;//0.5 * err;
  }

  /**
   * 计算梯度
   * @param out 输出梯度的数组
   */
  gradient(out) {
    for (let i = 0; i < this.params.length; ++i)
    {
      const val = this.params[i].get();
      const paramFunctions = this.functions[i];
      for (const fn of paramFunctions)
      {
        // const d0 = fn.d0(val);
        const d1 = fn.d1(val);
        out[i] += d1; //d0 * d1; //degenerated chain rule
      }
    }
  }

}

/**
 * 求解状态接口
 */
export interface SolveStatus {
  /** 是否求解成功 */
  success: boolean;
  /** 求解误差 */
  error: number;
}
