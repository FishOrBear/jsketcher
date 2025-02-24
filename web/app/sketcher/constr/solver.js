import QR from 'math/qr'
import LMOptimizer from 'math/optim/lm'
import { ConstantWrapper, EqualsTo } from './solverConstraints'
import { dog_leg } from 'math/optim/dogleg'
import { newVector } from 'math/vec';
import { fillArray } from "gems/iterables";


/**
 * @constructor
 * 约束系统类
 * 管理一组几何约束及其相关参数
 */
function System(constraints)
{
  // 存储约束数组
  this.constraints = constraints;
  // 存储系统中所有唯一的参数
  this.params = [];
  for (let ci = 0; ci < constraints.length; ++ci) {
    const c = constraints[ci];
    for (let pi = 0; pi < c.params.length; ++pi) {
      const p = c.params[pi];
      // 如果参数还未被索引,将其添加到系统参数列表中
      if (p.j == -1) {
        p.j = this.params.length;
        this.params.push(p);
      }
    }
  }
}


/**
 * 创建雅可比矩阵
 * 雅可比矩阵表示约束对参数的偏导数
 */
System.prototype.makeJacobian = function ()
{
  const jacobi = [];
  let i;
  let j;
  for (i = 0; i < this.constraints.length; i++) {
    jacobi[i] = [];
    for (j = 0; j < this.params.length; j++) {
      jacobi[i][j] = 0;
    }
  }
  for (i = 0; i < this.constraints.length; i++) {
    const c = this.constraints[i];

    const cParams = c.params;
    const grad = [];
    fillArray(grad, 0, cParams.length, 0);
    c.gradient(grad);

    for (let p = 0; p < cParams.length; p++) {
      const param = cParams[p];
      j = param.j;
      jacobi[i][j] = grad[p];
    }
  }
  return jacobi;
};

System.prototype.fillJacobian = function (jacobi)
{
  for (let i = 0; i < this.constraints.length; i++) {
    const c = this.constraints[i];

    const cParams = c.params;
    const grad = [];
    fillArray(grad, 0, cParams.length, 0);
    c.gradient(grad);

    for (let p = 0; p < cParams.length; p++) {
      const param = cParams[p];
      const j = param.j;
      jacobi[i][j] = grad[p];
    }
  }
  return jacobi;
};

/**
 * 计算系统的残差(误差)向量
 * @param {Array} r - 用于存储残差的数组
 * @returns {number} - 总误差平方和的一半
 */
System.prototype.calcResidual = function (r)
{

  let i = 0;
  let err = 0.;

  for (i = 0; i < this.constraints.length; i++) {
    const c = this.constraints[i];
    r[i] = c.error();
    err += r[i] * r[i];
  }

  err *= 0.5;
  return err;
};

/**
 * 计算梯度向量(二维)
 * 用于优化算法中确定搜索方向
 */
System.prototype.calcGrad_ = function (out)
{
  let i;
  for (i = 0; i < out.length || i < this.params.length; ++i) {
    out[i][0] = 0;
  }

  for (i = 0; i < this.constraints.length; i++) {
    const c = this.constraints[i];

    const cParams = c.params;
    const grad = [];
    fillArray(grad, 0, cParams.length, 0);
    c.gradient(grad);

    for (let p = 0; p < cParams.length; p++) {
      const param = cParams[p];
      const j = param.j;
      out[j][0] += this.constraints[i].error() * grad[p]; // (10.4)
    }
  }
};

/**
 * 计算梯度向量(一维)
 * 用于优化算法中确定搜索方向
 */
System.prototype.calcGrad = function (out)
{
  let i;
  for (i = 0; i < out.length || i < this.params.length; ++i) {
    out[i] = 0;
  }

  for (i = 0; i < this.constraints.length; i++) {
    const c = this.constraints[i];

    const cParams = c.params;
    const grad = [];
    fillArray(grad, 0, cParams.length, 0);
    c.gradient(grad);

    for (let p = 0; p < cParams.length; p++) {
      const param = cParams[p];
      const j = param.j;
      out[j] += this.constraints[i].error() * grad[p]; // (10.4)
    }
  }
};

System.prototype.fillParams = function (out)
{
  for (let p = 0; p < this.params.length; p++) {
    out[p] = this.params[p].get();
  }
};

System.prototype.getParams = function ()
{
  const out = [];
  this.fillParams(out);
  return out;
};

System.prototype.setParams = function (point)
{
  for (let p = 0; p < this.params.length; p++) {
    this.params[p].set(point[p]);
  }
};

System.prototype.error = function ()
{
  let error = 0;
  for (let i = 0; i < this.constraints.length; i++) {
    error += Math.abs(this.constraints[i].error());
  }
  return error;
};

System.prototype.errorSquare = function ()
{
  let error = 0;
  for (let i = 0; i < this.constraints.length; i++) {
    const t = this.constraints[i].error();
    error += t * t;
  }
  return error * 0.5;
};

System.prototype.getValues = function ()
{
  const values = [];
  for (let i = 0; i < this.constraints.length; i++) {
    values[i] = this.constraints[i].error();
  }
  return values;
};

System.prototype.rollback = function ()
{
  for (let p = 0; p < this.params.length; p++) {
    this.params[p].rollback();
  }
};

/**
 * 处理常量约束
 * 将包含常量参数的约束包装为特殊的约束对象
 */
function wrapConstants(constrs)
{
  for (let i = 0; i < constrs.length; i++) {
    const c = constrs[i];
    const mask = [];
    let needWrap = false;
    for (let j = 0; j < c.params.length; j++) {
      const param = c.params[j];
      mask[j] = param.constant === true;
      needWrap = needWrap || mask[j];
    }
    if (needWrap) {
      constrs[i] = new ConstantWrapper(c, mask);
    }
  }
  for (const constr of constrs) {
    if (constr.params.length === 0) {
      return constrs.filter(c => c.params.length !== 0);
    }
  }
  return constrs;
}

const lock2Equals2 = function (constrs, locked)
{
  const _locked = [];
  for (let i = 0; i < locked.length; ++i) {
    _locked.push(new EqualsTo([locked[i]], locked[i].get()));
  }
  return _locked;
};

/**
 * 诊断系统状态
 * 检查约束系统是否存在冲突以及自由度
 */
const diagnose = function (sys)
{
  if (sys.constraints.length === 0 || sys.params.length === 0) {
    return {
      conflict: false,
      dof: 0
    }
  }
  const jacobian = sys.makeJacobian();
  const qr = new QR(jacobian);
  return {
    conflict: sys.constraints.length > qr.rank,
    dof: sys.params.length - qr.rank
  }
};

/**
 * 准备约束系统求解
 * @param {Array} constrs - 约束数组
 * @param {Array} locked - 锁定的参数数组
 * @returns {Object} - 包含求解方法的系统求解器对象
 */
const prepare = function (constrs, locked)
{

  const simpleMode = true;
  let lockingConstrs;
  if (!simpleMode) {
    lockingConstrs = lock2Equals2(constrs, locked);
    Array.prototype.push.apply(constrs, lockingConstrs);
  }

  constrs = wrapConstants(constrs);
  const sys = new System(constrs);

  const model = function (point)
  {
    sys.setParams(point);
    return sys.getValues();
  };

  const jacobian = function (point)
  {
    sys.setParams(point);
    return sys.makeJacobian();
  };
  const nullResult = {
    evalCount: 0,
    error: 0,
    returnCode: 1
  };

  function solve(rough, alg)
  {
    //if (simpleMode) return nullResult;
    if (constrs.length === 0) return nullResult;
    if (sys.params.length === 0) return nullResult;
    // return solve_lm(sys, model, jacobian, rough);

    let result = dog_leg(sys, rough);
    if (!result.success) {
      console.log('dog leg failed, giving levenberg marquardt a shot');
      sys.rollback();
      result = solve_lm(sys, model, jacobian, rough)
    }
    return result;
  }
  const systemSolver = {
    diagnose: function () { return diagnose(sys) },
    error: function () { return sys.error() },
    solveSystem: solve,
    system: sys,
    updateLock: function (values)
    {
      for (let i = 0; i < values.length; ++i) {
        if (simpleMode) {
          locked[i].set(values[i]);
        } else {
          lockingConstrs[i].value = values[i];
        }
      }
    }
  };
  return systemSolver;
};

/**
 * 使用Levenberg-Marquardt算法求解系统
 * @param {System} sys - 约束系统
 * @param {Function} model - 模型函数
 * @param {Function} jacobian - 雅可比矩阵计算函数
 * @param {boolean} rough - 是否使用粗略求解
 * @returns {Object} - 求解结果
 */
const solve_lm = function (sys, model, jacobian, rough)
{
  const opt = new LMOptimizer(sys.getParams(), newVector(sys.constraints.length), model, jacobian);
  opt.evalMaximalCount = 100000; //100 * sys.params.length;
  const eps = rough ? 0.001 : 0.00000001;
  opt.init0(eps, eps, eps);
  let returnCode = 1;
  let res;
  try {
    res = opt.doOptimize();
  } catch (e) {
    returnCode = 2;
  }
  if (returnCode === 1) {
    sys.setParams(res[0]);
  }
  // console.log("LM result: ")
  // console.log({
  //   evalCount : opt.evalCount,
  //   error : sys.error(),
  // });

  return {
    evalCount: opt.evalCount,
    error: sys.error(),
    success: returnCode === 1 && sys.error() < 1e-3,
    returnCode: returnCode
  };
};

export { prepare }
