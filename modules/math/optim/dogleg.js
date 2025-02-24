/**
Dogleg(狗腿)算法是一种用于解决非线性最小二乘问题的优化算法。这个名字来源于算法寻找最优解的路径形状 - 它的搜索路径通常看起来像狗的后腿弯曲的形状。
这个算法结合了两种方法:
最速下降法(Steepest Descent)
高斯-牛顿法(Gauss-Newton)
具体来说，dogleg算法的工作方式是:
首先沿着最速下降方向移动一小步
然后转向高斯-牛顿方向
这种路径转折形成了类似狗腿的形状
在你的代码中，dog_leg函数实现了这个优化算法，用于求解非线性方程组。它主要用于:
最小化目标函数
寻找方程组的解
在信赖域范围内寻找最优步长
这是一个在数值优化中常用的算法，特别适合处理非线性最小二乘问题，比如在计算机视觉、机器人学等领域中的参数估计问题。
 */

import numeric from 'numeric';
import { _matrix, _vec } from '../vec';

const SUCCESS = 1, ITER_LIMIT = 2, SMALL_DELTA = 3, SMALL_STEP = 4, DIVERGENCE = 5, INVALID_STATE = 6;


/**
 * 求解矩阵的逆
 * @param {Array<Array<number>>} A - 输入矩阵
 * @returns {Array<Array<number>>} - 矩阵的逆
 */
var inv = function inv(A)
{
    A = numeric.clone(A);
    var s = numeric.dim(A), abs = Math.abs, m = s[0], n = s[1];
    var Ai, Aj;
    var I = numeric.identity(m), Ii, Ij;
    var i, j, k, x;
    for (j = 0; j < n; ++j) {
        var i0 = -1;
        var v0 = -1;
        for (i = j; i !== m; ++i) { k = abs(A[i][j]); if (k > v0) { i0 = i; v0 = k; } }
        Aj = A[i0]; A[i0] = A[j]; A[j] = Aj;
        Ij = I[i0]; I[i0] = I[j]; I[j] = Ij;
        x = Aj[j];
        if (x === 0) {
            console.log("CAN' INVERSE MATRIX");
            x = 1e-32
        }
        for (k = j; k !== n; ++k)    Aj[k] /= x;
        for (k = n - 1; k !== -1; --k) Ij[k] /= x;
        for (i = m - 1; i !== -1; --i) {
            if (i !== j) {
                Ai = A[i];
                Ii = I[i];
                x = Ai[j];
                for (k = j + 1; k !== n; ++k)  Ai[k] -= Aj[k] * x;
                for (k = n - 1; k > 0; --k) { Ii[k] -= Ij[k] * x; --k; Ii[k] -= Ij[k] * x; }
                if (k === 0) Ii[0] -= Ij[0] * x;
            }
        }
    }
    return I;
};

/**
 * 创建优化结果对象
 * @param {number} evalCount - 迭代次数
 * @param {number} error - 误差值
 * @param {number} returnCode - 返回代码
 * @returns {Object} 包含优化结果的对象
 */
var _result = function (evalCount, error, returnCode)
{
    return {
        evalCount, error, returnCode,
        success: returnCode === SUCCESS
    };
};

/**
 * Dogleg优化算法的主要实现
 * 这是一个信赖域优化算法，结合了最速下降法和高斯-牛顿法
 * @param {System} subsys - 包含约束系统的对象
 * @param {boolean} rough - 是否使用粗略计算（影响收敛精度）
 */
var dog_leg = function (subsys, rough)
{
    //rough = true
    //var tolg = rough ? 1e-3 : 1e-4;
    // 设置收敛容差
    var tolg, tolf;
    if (rough) {
        tolg = 1e-3; // 粗略模式下的梯度容差
        tolf = 1e-3; // 粗略模式下的函数值容差
    } else {
        tolg = 1e-6; // 精确模式下的梯度容差
        tolf = 1e-6; // 精确模式下的函数值容差
    }

    var tolx = 1e-80; // 变量更新的最小容差

    // 获取问题规模
    var xsize = subsys.params.length;    // 参数个数
    var csize = subsys.constraints.length; // 约束个数

    if (xsize == 0) {
        return _result(0, 0, 1);
    }

    var vec = _vec;
    var mx = _matrix;

    var n = numeric;

    var x = vec(xsize);
    var x_new = vec(xsize);

    var fx = vec(csize);
    var fx_new = vec(csize);

    var J = mx(csize, xsize);
    var J_new = mx(csize, xsize);
    var gn_step = vec(xsize);
    var dl_step = vec(xsize);

    subsys.fillParams(x);
    var err = subsys.calcResidual(fx);
    subsys.fillJacobian(J);

    /**
   * 使用矩阵求逆的方式求解线性方程组（计算开销较大）
   * @param {Array<Array<number>>} A - 系数矩阵
   * @param {Array<number>} b - 右侧向量
   * @returns {Array<number>} - 方程组的解
   */
    function lsolve_slow(A, b)
    {
        var At = n.transpose(A);
        var res = n.dot(n.dot(At, inv(n.dot(A, At))), b);
        return res;
    }

    /**
     * 求解线性方程组 Ax = b
     * 根据矩阵维度选择不同的求解策略
     * @param {Array<Array<number>>} A - 系数矩阵
     * @param {Array<number>} b - 右侧向量
     * @returns {Array<number>} - 方程组的解
     */
    function lsolve(A, b)
    {
        if (csize < xsize) {  // 约束数小于变量数：欠定方程组
            var At = n.transpose(A);  // 计算A的转置
            var sol = lu_solve(n.dot(A, At), b, true);  // 求解 (A*At)x = b
            return n.dot(At, sol);    // 计算最终解
        } else {  // 约束数大于等于变量数：超定或正定方程组
            return lu_solve(A, b, false);  // 直接使用LU分解求解
        }
    }

    var g = n.dot(n.transpose(J), fx);
    var g_inf = n.norminf(g);
    var fx_inf = n.norminf(fx);

    var iterLimit = rough ? 100 : 500;
    var divergenceLimit = 1e6 * (err + 1e6);

    var delta = 10;
    var alpha = 0.;
    var iter = 0, returnCode = 0;
    //var log = [];

    while (returnCode === 0) {
        dogleg.DEBUG_HANDLER(iter, err);

        // 检查终止条件
        if (fx_inf <= tolf) {
            returnCode = SUCCESS;           // 函数值收敛
        } else if (g_inf <= tolg) {
            returnCode = SUCCESS;           // 梯度收敛
        } else if (iter >= iterLimit) {
            returnCode = ITER_LIMIT;        // 达到最大迭代次数
        } else if (delta <= tolx * (tolx + n.norm2(x))) {
            returnCode = SMALL_DELTA;       // 信赖域半径过小
        } else if (err > divergenceLimit) {
            returnCode = DIVERGENCE;        // 发散
        } else if (isNaN(err)) {
            returnCode = INVALID_STATE;     // 无效状态
        }

        if (returnCode !== 0) {
            break;
        }

        // 计算高斯-牛顿步长
        // get the gauss-newton step
        //gn_step = n.solve(J, n.mul(fx, -1));
        gn_step = lsolve(J, n.mul(fx, -1));

        //LU-Decomposition
        //gn_step = lusolve(J, n.mul(fx, -1));

        //Conjugate gradient method
        //gn_step = cg(J, gn_step, n.mul(fx, -1), 1e-8, iterLimit);

        //solve linear problem using svd formula to get the gauss-newton step
        //gn_step = lls(J, n.mul(fx, -1));

        // 根据信赖域大小决定使用高斯-牛顿步长还是最速下降步长
        var hitBoundary = false;

        var gnorm = n.norm2(g);
        var gnNorm = n.norm2(gn_step);
        if (gnNorm < delta) {
            dl_step = gn_step;
        } else {
            var Jt = n.transpose(J);
            var B = n.dot(Jt, J);
            var gBg = n.dot(g, n.dot(B, g));
            alpha = n.norm2Squared(g) / gBg;
            if (alpha * gnorm >= delta) {
                dl_step = n.mul(g, - delta / gnorm);
                hitBoundary = true;
            } else {
                var sd_step = n.mul(g, - alpha);
                if (isNaN(gnNorm)) {
                    dl_step = sd_step;
                } else {

                    var d = n.sub(gn_step, sd_step);

                    var a = n.dot(d, d);
                    var b = 2 * n.dot(sd_step, d);
                    var c = n.dot(sd_step, sd_step) - delta * delta;

                    var sqrt_discriminant = Math.sqrt(b * b - 4 * a * c);

                    var beta = (-b + sqrt_discriminant) / (2 * a);

                    dl_step = n.add(sd_step, n.mul(beta, d));
                    hitBoundary = true;
                }
            }
        }

        var dl_norm = n.norm2(dl_step);

        //    if (dl_norm <= tolx) {
        //      returnCode = SMALL_STEP;
        //      break;
        //    }

        x_new = n.add(x, dl_step);
        subsys.setParams(x_new);
        var err_new = subsys.calcResidual(fx_new);
        subsys.fillJacobian(J_new);

        var fxNormSq = n.norm2Squared(fx);
        var dF = fxNormSq - n.norm2Squared(fx_new);
        var dL = fxNormSq - n.norm2Squared(n.add(fx, n.dot(J, dl_step)));

        var acceptCandidate;

        if (dF == 0 || dL == 0) {
            acceptCandidate = true;
        } else {
            var rho = dF / dL;
            if (rho < 0.25) {
                // if the model is a poor predictor reduce the size of the trust region
                delta = 0.25 * dl_norm;
                //delta *= 0.5;
            } else {
                // only increase the size of the trust region if it is taking a step of maximum size
                // otherwise just assume it's doing good enough job
                if (rho > 0.75 && hitBoundary) {
                    //delta = Math.max(delta,3*dl_norm);
                    delta *= 2;
                }
            }
            acceptCandidate = rho > 0; // could be 0 .. 0.25
        }
        //log.push([stepKind,err,  delta,rho]);

        if (acceptCandidate) {
            x = n.clone(x_new);
            J = n.clone(J_new);
            fx = n.clone(fx_new);
            err = err_new;

            g = n.dot(n.transpose(J), fx);

            // get infinity norms
            g_inf = n.norminf(g);
            fx_inf = n.norminf(fx);
        }

        iter++;
    }
    //log.push(returnCode);
    //window.___log(log);
    return _result(iter, err, returnCode);
};

/**
 * 高斯消元法实现
 * @param {Array<Array<number>>} A - 输入矩阵
 */
function gaussElimination(A)
{
    let h = 0;
    let k = 0;
    const m = A.length;
    const n = A[0].length;

    while (h < m && k < n) {

        let i_max = h;

        for (let i = h + 1; i < m; i++) {
            if (Math.abs(A[i][k]) > Math.abs(A[i_max][k])) {
                i_max = i;
            }
        }

        if (A[i_max][k] === 0) {
            /* No pivot in this column, pass to next column */
            k++;
        } else {
            let t = A[h];
            A[h] = A[i_max];
            A[i_max] = t;


            for (let i = h + 1; i < m; i++) {
                let f = A[i][k] / A[h][k]; //it cant be 0 here see condition up
                A[i][k] = 0;
                for (let j = k + 1; j < n; j++) {
                    A[i][j] = A[i][j] - A[h][j] * f;
                }
            }
            h++;
            k++;
        }
    }

}

/**
 * LU分解实现
 * @param {Array<Array<number>>} A - 输入矩阵
 * @param {boolean} fast - 是否使用快速模式
 * @returns {Object} 包含LU分解结果的对象
 */
function LU(A, fast)
{
    fast = fast || false;

    var abs = Math.abs;
    var i, j, k, absAjk, Akk, Ak, Pk, Ai;
    var max;
    var n = A.length, n1 = n - 1;
    var P = new Array(n);
    if (!fast) A = numeric.clone(A);

    for (k = 0; k < n; ++k) {
        Pk = k;
        Ak = A[k];
        max = abs(Ak[k]);
        for (j = k + 1; j < n; ++j) {
            absAjk = abs(A[j][k]);
            if (max < absAjk) {
                max = absAjk;
                Pk = j;
            }
        }
        P[k] = Pk;

        if (Pk != k) {
            A[k] = A[Pk];
            A[Pk] = Ak;
            Ak = A[k];
        }

        Akk = Ak[k];

        if (Akk === 0) {
            Akk = 0.0000001;
        }

        for (i = k + 1; i < n; ++i) {
            A[i][k] /= Akk;
        }

        for (i = k + 1; i < n; ++i) {
            Ai = A[i];
            for (j = k + 1; j < n1; ++j) {
                Ai[j] -= Ai[k] * Ak[j];
                ++j;
                Ai[j] -= Ai[k] * Ak[j];
            }
            if (j === n1) Ai[j] -= Ai[k] * Ak[j];
        }
    }

    return {
        LU: A,
        P: P
    };
}

function LUsolve(LUP, b)
{
    var i, j;
    var LU = LUP.LU;
    var n = LU.length;
    var x = numeric.clone(b);
    var P = LUP.P;
    var Pi, LUi, LUii, tmp;

    for (i = n - 1; i !== -1; --i) x[i] = b[i];
    for (i = 0; i < n; ++i) {
        Pi = P[i];
        if (P[i] !== i) {
            tmp = x[i];
            x[i] = x[Pi];
            x[Pi] = tmp;
        }

        LUi = LU[i];
        for (j = 0; j < i; ++j) {
            x[i] -= x[j] * LUi[j];
        }
    }

    for (i = n - 1; i >= 0; --i) {
        LUi = LU[i];
        for (j = i + 1; j < n; ++j) {
            x[i] -= x[j] * LUi[j];
        }
        if (LUi[i] !== 0) { // We want it because it 99% of the time happens when penalty function returns ZERO gradient, so we just ignore zero-rows
            x[i] /= LUi[i];
        }
    }

    return x;
}

function lu_solve(A, b, fast)
{
    const lu = LU(A, fast);
    return LUsolve(lu, b);
}

/**
 * 共轭梯度法求解线性方程组
 * @param {Array<Array<number>>} A - 系数矩阵
 * @param {Array<number>} x - 初始解
 * @param {Array<number>} b - 右侧向量
 * @param {number} tol - 收敛容差
 * @param {number} maxIt - 最大迭代次数
 * @returns {Array<number>} 方程组的解
 */
var cg = function (A, x, b, tol, maxIt)
{

    var _ = numeric;

    var tr = _.transpose;
    var At = tr(A);
    if (A.length != A[0].length) {
        A = _.dot(At, A);
        b = _.dot(At, b);
    }

    var r = _.sub(_.dot(A, x), b);
    var p = _.mul(r, -1);
    var rr = _.dotVV(r, r);

    var a;
    var _rr;
    var beta;

    for (var i = 0; i < maxIt; ++i) {
        if (_.norm2(r) <= tol) break;
        var Axp = _.dot(A, p);
        a = rr / _.dotVV(Axp, p);
        x = _.add(x, _.mul(p, a));
        r = _.add(r, _.mul(Axp, a));
        _rr = rr;
        rr = _.dotVV(r, r);
        beta = rr / _rr;
        p = _.add(_.mul(r, -1), _.mul(p, beta));
    }
    //  console.log("liner problem solved in " + i);
    return x;
};

var dogleg = { DEBUG_HANDLER: function () { } }; //backward compatibility

export { dog_leg, dogleg }
