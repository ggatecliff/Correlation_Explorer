import { useState, useMemo, useCallback, useRef } from "react";
import {
  ScatterChart, Scatter, LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from "recharts";
import {
  UploadCloud, Activity, Layers, RefreshCw, Eye, Info, GitBranch, Crosshair,
  Grid3X3, ArrowRight, Target, Plus, Trash2, Check, Link2, Merge,
  AlertTriangle, Zap, Shield, FlaskConical, Brain, TestTube2, TrendingUp
} from "lucide-react";
import * as XLSX from "xlsx";

// ═══════════════════════════════════════════════════════════
//  PURE-JS STATISTICS LIBRARY
// ═══════════════════════════════════════════════════════════
const STAT = (() => {
  // -- Math helpers --
  const erf = x => { const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911; const s=x<0?-1:1; x=Math.abs(x); const t=1/(1+p*x); return s*(1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x)); };
  const normCDF = x => .5*(1+erf(x/Math.SQRT2));
  const lG = x => { const c=[.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7]; if(x<.5) return Math.log(Math.PI/Math.sin(Math.PI*x))-lG(1-x); x-=1; let a=c[0]; for(let i=1;i<9;i++) a+=c[i]/(x+i); const t=x+7.5; return .5*Math.log(2*Math.PI)+(x+.5)*Math.log(t)-t+Math.log(a); };
  const bCF = (a,b,x) => { let qab=a+b,qap=a+1,qam=a-1,c=1,d=1-qab*x/qap; if(Math.abs(d)<1e-30)d=1e-30; d=1/d; let h=d; for(let m=1;m<=200;m++){ let m2=2*m,aa=m*(b-m)*x/((qam+m2)*(a+m2)); d=1+aa*d; if(Math.abs(d)<1e-30)d=1e-30; c=1+aa/c; if(Math.abs(c)<1e-30)c=1e-30; d=1/d; h*=d*c; aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2)); d=1+aa*d; if(Math.abs(d)<1e-30)d=1e-30; c=1+aa/c; if(Math.abs(c)<1e-30)c=1e-30; d=1/d; h*=d*c; if(Math.abs(d*c-1)<3e-7) break; } return h; };
  const rBI = (a,b,x) => { if(x<=0) return 0; if(x>=1) return 1; const bt=Math.exp(lG(a+b)-lG(a)-lG(b)+a*Math.log(x)+b*Math.log(1-x)); return x<(a+1)/(a+b+2) ? bt*bCF(a,b,x)/a : 1-bt*bCF(b,a,1-x)/b; };
  const tCDF = (t,df) => { if(df<=0) return .5; const x=df/(df+t*t); return 1-.5*rBI(df/2,.5,x); };
  const fCDF = (f,d1,d2) => { if(f<=0) return 0; return rBI(d1/2,d2/2,d1*f/(d1*f+d2)); };

  const mean = a => a.reduce((s,v)=>s+v,0)/a.length;
  const std = (a,ddof=1) => { const m=mean(a); return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/Math.max(a.length-ddof,1)); };
  const rank = a => { const s=[...a].map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v); const r=new Array(a.length); let i=0; while(i<s.length){ let j=i; while(j<s.length&&s[j].v===s[i].v) j++; const avg=(i+j-1)/2+1; for(let k=i;k<j;k++) r[s[k].i]=avg; i=j; } return r; };

  // -- Pearson --
  function pearson(x,y) {
    const n=x.length; if(n<3) return {r:0,p:1};
    const mx=mean(x),my=mean(y); let nm=0,dx=0,dy=0;
    for(let i=0;i<n;i++){const a=x[i]-mx,b=y[i]-my; nm+=a*b; dx+=a*a; dy+=b*b;}
    const d=Math.sqrt(dx*dy); if(d<1e-15) return {r:0,p:1};
    const r=Math.max(-1,Math.min(1,nm/d));
    if(Math.abs(r)>=1-1e-12) return {r:r>0?1:-1, p:0};
    const t=r*Math.sqrt((n-2)/(1-r*r));
    const df=n-2, xb=df/(df+t*t);
    return {r, p:rBI(df/2,.5,xb)};
  }

  // -- Spearman --
  function spearman(x,y) { return pearson(rank(x),rank(y)); }

  // -- Kendall --
  function kendall(x,y) {
    const n=x.length; if(n<3) return {tau:0,p:1};
    let c=0,d=0; for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){const a=x[j]-x[i],b=y[j]-y[i]; if(a*b>0)c++; else if(a*b<0)d++;}
    const tau=(c-d)/(n*(n-1)/2);
    const z=3*tau*Math.sqrt(n*(n-1))/(Math.sqrt(2*(2*n+5)));
    return {tau,p:2*(1-normCDF(Math.abs(z)))};
  }

  // -- Distance Correlation --
  function dCor(x,y) {
    const n=x.length; if(n<5) return 0;
    const N=Math.min(n,300); // cap for O(n²)
    const xs=x.slice(0,N),ys=y.slice(0,N);
    const aM=[], bM=[];
    for(let i=0;i<N;i++){ aM[i]=[]; bM[i]=[]; for(let j=0;j<N;j++){ aM[i][j]=Math.abs(xs[i]-xs[j]); bM[i][j]=Math.abs(ys[i]-ys[j]); }}
    const aRow=aM.map(r=>mean(r)), bRow=bM.map(r=>mean(r));
    const aAll=mean(aRow), bAll=mean(bRow);
    // Center
    const A=[], B=[];
    for(let i=0;i<N;i++){ A[i]=[]; B[i]=[]; for(let j=0;j<N;j++){ A[i][j]=aM[i][j]-aRow[i]-aRow[j]+aAll; B[i][j]=bM[i][j]-bRow[i]-bRow[j]+bAll; }}
    let dCov2=0, dVarX=0, dVarY=0;
    for(let i=0;i<N;i++) for(let j=0;j<N;j++){ dCov2+=A[i][j]*B[i][j]; dVarX+=A[i][j]*A[i][j]; dVarY+=B[i][j]*B[i][j]; }
    dCov2/=N*N; dVarX/=N*N; dVarY/=N*N;
    const den=Math.sqrt(dVarX*dVarY);
    return den<1e-15 ? 0 : Math.sqrt(Math.max(0,dCov2/den));
  }

  // -- Mutual Information (k-NN approx) --
  function mutualInfo(x,y,k=3) {
    const n=x.length; if(n<k*3) return 0;
    const N=Math.min(n,500);
    const xs=x.slice(0,N),ys=y.slice(0,N);
    const sx=std(xs,0)||1, sy=std(ys,0)||1, mx2=mean(xs), my2=mean(ys);
    const xn=xs.map(v=>(v-mx2)/sx), yn=ys.map(v=>(v-my2)/sy);
    let miSum=0;
    const digamma = v => { let r=0; while(v<6){r-=1/v;v++;} return r+Math.log(v)-1/(2*v)-1/(12*v*v); };
    const psiN=digamma(N), psiK=digamma(k);
    for(let i=0;i<N;i++){
      const dists=[];
      for(let j=0;j<N;j++){ if(i===j) continue; dists.push(Math.max(Math.abs(xn[i]-xn[j]),Math.abs(yn[i]-yn[j])));}
      dists.sort((a,b)=>a-b);
      const eps=dists[k-1]+1e-15;
      let nx=0,ny=0;
      for(let j=0;j<N;j++){ if(i===j) continue; if(Math.abs(xn[i]-xn[j])<eps) nx++; if(Math.abs(yn[i]-yn[j])<eps) ny++; }
      miSum+=digamma(Math.max(nx,1))+digamma(Math.max(ny,1));
    }
    return Math.max(0, psiK - miSum/N + psiN);
  }

  // -- Permutation Test --
  function permTest(x,y,nPerm=499) {
    const obs=Math.abs(pearson(x,y).r);
    let count=0;
    const n=x.length, xCopy=[...x];
    for(let p=0;p<nPerm;p++){
      for(let i=n-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[xCopy[i],xCopy[j]]=[xCopy[j],xCopy[i]];}
      if(Math.abs(pearson(xCopy,y).r)>=obs) count++;
    }
    return (count+1)/(nPerm+1);
  }

  // -- Bootstrap CI --
  function bootstrapCI(x,y,nBoot=499,ci=0.95) {
    const n=x.length, rs=[];
    for(let b=0;b<nBoot;b++){
      const idx=Array.from({length:n},()=>Math.floor(Math.random()*n));
      const xb=idx.map(i=>x[i]),yb=idx.map(i=>y[i]);
      rs.push(pearson(xb,yb).r);
    }
    rs.sort((a,b)=>a-b);
    const lo=rs[Math.floor((1-ci)/2*nBoot)], hi=rs[Math.floor((1+ci)/2*nBoot)];
    return {lo,hi};
  }

  // -- ACF --
  function acf(x,maxLag=5) {
    const n=x.length,m=mean(x); let c0=0; for(let i=0;i<n;i++) c0+=(x[i]-m)**2; c0/=n;
    const result=[1];
    for(let lag=1;lag<=maxLag;lag++){let ck=0; for(let i=0;i<n-lag;i++) ck+=(x[i]-m)*(x[i+lag]-m); ck/=n; result.push(c0>0?ck/c0:0);}
    return result;
  }

  // -- ADF (simplified: ADF statistic via OLS on Δy = α + β*y_{t-1} + ε) --
  function adfTest(x) {
    const n=x.length; if(n<10) return {stat:0,p:1,stationary:false};
    const dy=[],yl=[];
    for(let i=1;i<n;i++){dy.push(x[i]-x[i-1]);yl.push(x[i-1]);}
    const m=dy.length;
    const myl=mean(yl),mdy=mean(dy);
    let num=0,den=0;
    for(let i=0;i<m;i++){num+=(yl[i]-myl)*(dy[i]-mdy);den+=(yl[i]-myl)**2;}
    const b=den?num/den:0, a=mdy-b*myl;
    let sse=0; for(let i=0;i<m;i++) sse+=(dy[i]-a-b*yl[i])**2;
    const se=Math.sqrt(sse/Math.max(m-2,1)/Math.max(den,1e-15));
    const stat=se>0?b/se:0;
    // ADF critical values (with constant, no trend): -3.43(1%), -2.86(5%), -2.57(10%)
    const stationary = stat < -2.86;
    const p = stat < -3.43 ? 0.01 : stat < -2.86 ? 0.05 : stat < -2.57 ? 0.10 : 0.50;
    return {stat,p,stationary};
  }

  // -- LOWESS --
  function lowess(x,y,frac=0.3) {
    const n=x.length, k=Math.max(3,Math.floor(n*frac));
    const idx=[...Array(n).keys()].sort((a,b)=>x[a]-x[b]);
    const sx=idx.map(i=>x[i]),sy=idx.map(i=>y[i]),result=[];
    for(let i=0;i<n;i++){
      const dists=sx.map((v,j)=>({j,d:Math.abs(v-sx[i])})).sort((a,b)=>a.d-b.d).slice(0,k);
      const maxD=dists[dists.length-1].d||1;
      let wSum=0,wxSum=0,wySum=0,wxxSum=0,wxySum=0;
      dists.forEach(({j,d})=>{
        const u=d/maxD, w=(1-u*u*u); // tricube
        const wt=w*w*w;
        wSum+=wt; wxSum+=wt*sx[j]; wySum+=wt*sy[j]; wxxSum+=wt*sx[j]*sx[j]; wxySum+=wt*sx[j]*sy[j];
      });
      const det=wSum*wxxSum-wxSum*wxSum;
      const yhat=det>1e-15?(wxxSum*wySum-wxSum*wxySum)/det+(wSum*wxySum-wxSum*wySum)/det*sx[i]:mean(dists.map(({j})=>sy[j]));
      result.push({x:sx[i],y:yhat});
    }
    return result;
  }

  // -- Cross-correlation --
  function ccf(x,y,maxLag=12) {
    const res=[];
    for(let lag=-maxLag;lag<=maxLag;lag++){
      let xv,yv;
      if(lag>=0){xv=x.slice(0,x.length-lag||undefined);yv=y.slice(lag);}
      else{const al=-lag;xv=x.slice(al);yv=y.slice(0,y.length-al);}
      const n=Math.min(xv.length,yv.length);
      if(n<3) continue;
      res.push({lag,r:pearson(xv.slice(0,n),yv.slice(0,n)).r});
    }
    return res;
  }

  // -- Granger Causality (simplified: compare AR(p) vs AR(p)+X model via F-test) --
  function granger(target,signal,maxLag=4) {
    const n=target.length; if(n<maxLag*2+10) return {bestLag:null,bestP:1,significant:false};
    let bestP=1, bestLag=null;
    for(let p=1;p<=maxLag;p++){
      const m=n-p; if(m<10) continue;
      const y=[],X1=[],X2=[];
      for(let t=p;t<n;t++){
        y.push(target[t]);
        const row1=[1],row2=[1]; // intercept
        for(let l=1;l<=p;l++){row1.push(target[t-l]);row2.push(target[t-l]);row2.push(signal[t-l]);}
        X1.push(row1);X2.push(row2);
      }
      // OLS for both models, compute RSS
      const rss1=olsRSS(X1,y), rss2=olsRSS(X2,y);
      const df1=p, df2=m-2*p-1; // additional params, residual df
      if(df2<=0||rss2<=0) continue;
      const fStat=((rss1-rss2)/df1)/(rss2/df2);
      const pVal=1-fCDF(fStat,df1,df2);
      if(pVal<bestP){bestP=pVal;bestLag=p;}
    }
    return {bestLag,bestP,significant:bestP<0.05};
  }

  function olsRSS(X,y) {
    // Solve via normal equations (small matrices)
    const m=X.length, k=X[0].length;
    // X'X
    const XtX=Array.from({length:k},()=>new Array(k).fill(0));
    const Xty=new Array(k).fill(0);
    for(let i=0;i<m;i++) for(let j=0;j<k;j++){Xty[j]+=X[i][j]*y[i]; for(let l=0;l<k;l++) XtX[j][l]+=X[i][j]*X[i][l];}
    // Solve via Gaussian elimination
    const aug=XtX.map((r,i)=>[...r,Xty[i]]);
    for(let i=0;i<k;i++){
      let maxR=i; for(let j=i+1;j<k;j++) if(Math.abs(aug[j][i])>Math.abs(aug[maxR][i])) maxR=j;
      [aug[i],aug[maxR]]=[aug[maxR],aug[i]];
      if(Math.abs(aug[i][i])<1e-15) continue;
      for(let j=i+1;j<k;j++){const f=aug[j][i]/aug[i][i]; for(let l=i;l<=k;l++) aug[j][l]-=f*aug[i][l];}
    }
    const beta=new Array(k).fill(0);
    for(let i=k-1;i>=0;i--){let s=aug[i][k]; for(let j=i+1;j<k;j++) s-=aug[i][j]*beta[j]; beta[i]=Math.abs(aug[i][i])>1e-15?s/aug[i][i]:0;}
    // RSS
    let rss=0;
    for(let i=0;i<m;i++){let yhat=0; for(let j=0;j<k;j++) yhat+=X[i][j]*beta[j]; rss+=(y[i]-yhat)**2;}
    return rss;
  }

  // -- Bonferroni correction --
  function bonferroni(pvals,alpha=0.05) {
    const n=pvals.length, corrected=pvals.map(p=>Math.min(p*n,1));
    return corrected.map(p=>({p,significant:p<alpha}));
  }

  return { pearson,spearman,kendall,dCor,mutualInfo,permTest,bootstrapCI,acf,adfTest,lowess,ccf,granger,bonferroni,mean,std,rank };
})();

// ═══════════════════════════════════════════════════════════
//  PURE-JS ML ENGINE (Mini Gradient Boosting)
// ═══════════════════════════════════════════════════════════
const ML = (() => {
  // Decision stump: find best split on one feature
  function bestSplit(X,residuals,featureIdx) {
    const n=X.length; if(n<4) return null;
    const vals=X.map((r,i)=>({v:r[featureIdx],r:residuals[i]})).sort((a,b)=>a.v-b.v);
    let bestGain=-Infinity,bestThresh=0,bestLeft=0,bestRight=0;
    let leftSum=0,leftN=0,totalSum=residuals.reduce((a,b)=>a+b,0);
    for(let i=0;i<n-1;i++){
      leftSum+=vals[i].r; leftN++;
      const rightSum=totalSum-leftSum, rightN=n-leftN;
      if(rightN<1) continue;
      const gain=leftSum*leftSum/leftN+rightSum*rightSum/rightN;
      if(gain>bestGain){bestGain=gain;bestThresh=(vals[i].v+vals[i+1].v)/2;bestLeft=leftSum/leftN;bestRight=rightSum/rightN;}
    }
    return {featureIdx,threshold:bestThresh,leftVal:bestLeft,rightVal:bestRight,gain:bestGain};
  }

  function fitGBM(X,y,nTrees=50,lr=0.1) {
    const n=X.length,nFeats=X[0].length;
    const basePred=STAT.mean(y);
    let preds=new Array(n).fill(basePred);
    const trees=[];
    for(let t=0;t<nTrees;t++){
      const residuals=y.map((yi,i)=>yi-preds[i]);
      let bestTree=null;
      for(let f=0;f<nFeats;f++){
        const split=bestSplit(X,residuals,f);
        if(split&&(!bestTree||split.gain>bestTree.gain)) bestTree=split;
      }
      if(!bestTree) break;
      trees.push({...bestTree,lr});
      for(let i=0;i<n;i++){
        const val=X[i][bestTree.featureIdx]<=bestTree.threshold?bestTree.leftVal:bestTree.rightVal;
        preds[i]+=lr*val;
      }
    }
    return {basePred,trees};
  }

  function predictGBM(model,X) {
    return X.map(row=>{
      let p=model.basePred;
      model.trees.forEach(t=>{p+=t.lr*(row[t.featureIdx]<=t.threshold?t.leftVal:t.rightVal);});
      return p;
    });
  }

  function rmse(actual,pred) { let s=0; for(let i=0;i<actual.length;i++) s+=(actual[i]-pred[i])**2; return Math.sqrt(s/actual.length); }

  // Permutation importance
  function permImportance(model,X,y,nShuffles=5) {
    const basePreds=predictGBM(model,X);
    const baseRMSE=rmse(y,basePreds);
    const nFeats=X[0].length;
    const importances=[];
    for(let f=0;f<nFeats;f++){
      let totalDrop=0;
      for(let s=0;s<nShuffles;s++){
        const Xperm=X.map(r=>[...r]);
        const perm=[...Xperm.map(r=>r[f])];
        for(let i=perm.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[perm[i],perm[j]]=[perm[j],perm[i]];}
        Xperm.forEach((r,i)=>{r[f]=perm[i];});
        const permRMSE=rmse(y,predictGBM(model,Xperm));
        totalDrop+=permRMSE-baseRMSE;
      }
      importances.push(totalDrop/nShuffles);
    }
    return importances;
  }

  // Walk-forward validation
  function walkForward(X,y,featureSubset,nFolds=5,minTrain=30) {
    const n=X.length, step=Math.max(1,Math.floor((n-minTrain)/nFolds)), testSize=step;
    const rmses=[];
    for(let fold=0;fold<nFolds;fold++){
      const trainEnd=minTrain+fold*step;
      const testEnd=Math.min(trainEnd+testSize,n);
      if(trainEnd>=n||testEnd<=trainEnd) continue;
      const Xtr=X.slice(0,trainEnd).map(r=>featureSubset.map(f=>r[f]));
      const ytr=y.slice(0,trainEnd);
      const Xte=X.slice(trainEnd,testEnd).map(r=>featureSubset.map(f=>r[f]));
      const yte=y.slice(trainEnd,testEnd);
      if(Xtr.length<20||Xte.length<5) continue;
      const model=fitGBM(Xtr,ytr,30,0.1);
      rmses.push(rmse(yte,predictGBM(model,Xte)));
    }
    return rmses.length?STAT.mean(rmses):Infinity;
  }

  return {fitGBM,predictGBM,rmse,permImportance,walkForward};
})();

// ═══════════════════════════════════════════════════════════
//  TEST SUITE
// ═══════════════════════════════════════════════════════════
function runTests() {
  const results = [];
  const check = (name, ok, detail="") => results.push({name,ok,detail});

  // -- Pearson: known values --
  const x1=[1,2,3,4,5], y1=[2,4,6,8,10]; // perfect positive
  const p1=STAT.pearson(x1,y1);
  check("Pearson: perfect positive r≈1", Math.abs(p1.r-1)<0.001, `r=${p1.r.toFixed(4)}`);
  check("Pearson: perfect positive p≈0", p1.p<0.01, `p=${p1.p.toFixed(4)}`);

  const y2=[10,8,6,4,2]; // perfect negative
  const p2=STAT.pearson(x1,y2);
  check("Pearson: perfect negative r≈-1", Math.abs(p2.r+1)<0.001, `r=${p2.r.toFixed(4)}`);

  const y3=[3,1,4,1,5]; // weak
  const p3=STAT.pearson(x1,y3);
  check("Pearson: weak correlation |r|<0.5", Math.abs(p3.r)<0.5, `r=${p3.r.toFixed(4)}`);

  // -- Spearman: monotonic but not linear --
  const x4=[1,2,3,4,5], y4=[1,4,9,16,25]; // y=x², monotonic
  const sp4=STAT.spearman(x4,y4);
  check("Spearman: monotonic y=x² r=1", Math.abs(sp4.r-1)<0.001, `r=${sp4.r.toFixed(4)}`);
  const pe4=STAT.pearson(x4,y4);
  check("Pearson < Spearman for y=x²", pe4.r<sp4.r, `Pearson=${pe4.r.toFixed(4)}, Spearman=${sp4.r.toFixed(4)}`);

  // -- Kendall --
  const k1=STAT.kendall(x1,y1);
  check("Kendall: perfect concordance τ=1", Math.abs(k1.tau-1)<0.001, `τ=${k1.tau.toFixed(4)}`);
  const k2=STAT.kendall(x1,y2);
  check("Kendall: perfect discordance τ=-1", Math.abs(k2.tau+1)<0.001, `τ=${k2.tau.toFixed(4)}`);

  // -- Distance Correlation --
  const dc1=STAT.dCor(x1,y1);
  check("dCor: perfect linear ≈1", dc1>0.9, `dCor=${dc1.toFixed(4)}`);
  // dCor should catch nonlinear too
  const xc=[...Array(50)].map((_,i)=>-2+4*i/49), yc=xc.map(v=>v*v); // parabola
  const dc_nl=STAT.dCor(xc,yc);
  const pe_nl=STAT.pearson(xc,yc);
  check("dCor > |Pearson| for parabola", dc_nl>Math.abs(pe_nl.r), `dCor=${dc_nl.toFixed(4)}, Pearson=${pe_nl.r.toFixed(4)}`);

  // -- Mutual Information --
  const mi_x=Array.from({length:50},(_,i)=>i);
  const mi_y=mi_x.map(v=>2*v+1);
  const mi1=STAT.mutualInfo(mi_x,mi_y);
  check("MI: perfect linear > 0", mi1>0, `MI=${mi1.toFixed(4)}`);
  // Independent signals should have low MI
  const xr=Array.from({length:100},()=>Math.random()), yr=Array.from({length:100},()=>Math.random());
  const mi_ind=STAT.mutualInfo(xr,yr);
  check("MI: independent ≈ 0 (< 0.15)", mi_ind<0.15, `MI=${mi_ind.toFixed(4)}`);

  // -- ACF --
  const acf1=STAT.acf([1,2,3,4,5,6,7,8,9,10],3);
  check("ACF: lag0 = 1", Math.abs(acf1[0]-1)<0.001, `ACF[0]=${acf1[0].toFixed(4)}`);
  check("ACF: trending data lag1 > 0", acf1[1]>0, `ACF[1]=${acf1[1].toFixed(4)}`);

  // -- ADF --
  const stationary=Array.from({length:200},()=>Math.random()*10);
  const adf_s=STAT.adfTest(stationary);
  check("ADF: random data is stationary", adf_s.stationary, `stat=${adf_s.stat.toFixed(2)},p=${adf_s.p}`);
  const trending=Array.from({length:200},(_,i)=>i+Math.random());
  const adf_t=STAT.adfTest(trending);
  check("ADF: trending data is non-stationary", !adf_t.stationary, `stat=${adf_t.stat.toFixed(2)},p=${adf_t.p}`);

  // -- LOWESS --
  const lw=STAT.lowess([1,2,3,4,5],[2,4,6,8,10],0.6);
  check("LOWESS: returns points", lw.length===5, `got ${lw.length} points`);
  check("LOWESS: reasonable values", Math.abs(lw[2].y-6)<2, `middle=${lw[2].y.toFixed(2)}`);

  // -- CCF --
  const ccf1=STAT.ccf(x1,y1,2);
  const lag0=ccf1.find(c=>c.lag===0);
  check("CCF: lag0 matches Pearson", lag0&&Math.abs(lag0.r-1)<0.01, `r=${lag0?.r.toFixed(4)}`);

  // -- Granger --
  const xg=Array.from({length:80},()=>Math.random()*10);
  const yg=xg.map((_,i)=>i>1?0.8*xg[i-2]+Math.random():Math.random()); // y depends on x with lag 2
  const gr=STAT.granger(yg,xg,4);
  check("Granger: detects lagged causality", gr.significant, `p=${gr.bestP.toFixed(4)}, lag=${gr.bestLag}`);
  const yg2=Array.from({length:80},()=>Math.random()*10); // independent
  const gr2=STAT.granger(yg2,xg,4);
  check("Granger: rejects independent", !gr2.significant||gr2.bestP>0.01, `p=${gr2.bestP.toFixed(4)}`);

  // -- Permutation Test --
  const pp1=STAT.permTest(x1,y1,199);
  check("Perm test: perfect corr p<0.05", pp1<0.05, `p=${pp1.toFixed(4)}`);
  const pp2=STAT.permTest(xr.slice(0,30),yr.slice(0,30),199);
  check("Perm test: independent p>0.05", pp2>0.05, `p=${pp2.toFixed(4)}`);

  // -- Bootstrap CI --
  const ci1=STAT.bootstrapCI(x1,y1,199);
  check("Bootstrap CI: perfect corr CI contains 1", ci1.hi>=0.95, `[${ci1.lo.toFixed(3)},${ci1.hi.toFixed(3)}]`);

  // -- Bonferroni --
  const bf=STAT.bonferroni([0.01,0.04,0.5],0.05);
  check("Bonferroni: 0.01*3=0.03 < 0.05 → sig", bf[0].significant, `corrected p=${bf[0].p.toFixed(3)}`);
  check("Bonferroni: 0.04*3=0.12 > 0.05 → ns", !bf[1].significant, `corrected p=${bf[1].p.toFixed(3)}`);

  // -- ML: GBM --
  const Xml=Array.from({length:100},(_,i)=>([i,Math.sin(i/10)]));
  const yml=Xml.map(r=>2*r[0]+3*r[1]+Math.random());
  const model=ML.fitGBM(Xml,yml,50,0.1);
  const preds=ML.predictGBM(model,Xml);
  const mlRmse=ML.rmse(yml,preds);
  check("GBM: train RMSE < 5", mlRmse<5, `RMSE=${mlRmse.toFixed(2)}`);

  // -- Permutation Importance --
  const imp=ML.permImportance(model,Xml,yml,3);
  check("Perm importance: feature 0 (strong) > feature 1", imp[0]>imp[1], `imp[0]=${imp[0].toFixed(4)}, imp[1]=${imp[1].toFixed(4)}`);

  return results;
}

// ── UI TOKENS & COMPONENTS ──────────────────────────────
const T={
  bg:"#0D1117",bgCard:"#161B22",bgSurface:"#1C2330",bgInput:"#0D1117",bgHover:"#1F2937",
  accent:"#58A6FF",accentDim:"rgba(88,166,255,.08)",
  border:"#30363D",
  text:"#E6EDF3",textMuted:"#8B949E",textDim:"#484F58",
  green:"#3FB950",red:"#F85149",redDim:"rgba(248,81,73,.15)",orange:"#D29922",yellow:"#E3B341",blue:"#58A6FF",purple:"#BC8CFF",pink:"#FF7EB3",cyan:"#39D0D8",
  font:"'JetBrains Mono',monospace",fontSans:"'DM Sans',sans-serif",
  r:"6px",rLg:"12px"
};
const crdS={background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.rLg,padding:"18px"};
const lbS={fontSize:"10px",fontFamily:T.font,color:T.textMuted,textTransform:"uppercase",letterSpacing:".08em",fontWeight:500};
const Badge=({text,color})=><span style={{display:"inline-block",padding:"2px 7px",borderRadius:"4px",fontSize:"9px",fontFamily:T.font,fontWeight:600,background:color+"20",color}}>{text}</span>;
function Sel({label:l,value:v,options:o,onChange:c,width:w}){return(<div style={{display:"flex",flexDirection:"column",gap:"2px"}}>{l&&<div style={{...lbS,fontSize:"9px"}}>{l}</div>}<select value={v} onChange={e=>c(e.target.value)} style={{background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:"6px",padding:"5px 8px",color:T.text,fontFamily:T.fontSans,fontSize:"11px",width:w||"150px",outline:"none",cursor:"pointer"}}>{o.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></div>);}
function Chip({label,active,color,onClick}){return(<button onClick={onClick} style={{padding:"4px 10px",borderRadius:"5px",border:`1px solid ${active?color:T.border}`,background:active?color+"18":"transparent",color:active?color:T.textMuted,fontSize:"11px",fontFamily:T.fontSans,cursor:"pointer"}}>{label}</button>);}
function Tip({active,payload}){if(!active||!payload?.length)return null;return(<div style={{background:"#1A2232",border:`1px solid ${T.border}`,borderRadius:"8px",padding:"8px 12px",fontSize:"10px",fontFamily:T.font,boxShadow:"0 8px 24px rgba(0,0,0,.5)"}}>{payload.map((p,i)=><div key={i} style={{display:"flex",gap:"5px",marginBottom:"1px"}}><span style={{width:6,height:6,borderRadius:"50%",background:p.color,marginTop:3,flexShrink:0}}/><span style={{color:T.textMuted}}>{p.name}:</span><span style={{color:T.text,fontWeight:600}}>{fmt(p.value)}</span></div>)}</div>);}
const corrColor=r=>{if(r==null||isNaN(r))return T.textDim;const a=Math.abs(r);return a>.5?(r>0?T.green:T.red):a>.2?(r>0?"#66BB6A":"#EF5350"):T.textDim;};
const corrBg=r=>{if(r==null||isNaN(r))return"transparent";const a=Math.min(Math.abs(r),1);const c=r>0?[34,197,94]:[240,72,72];return`rgba(${c[0]},${c[1]},${c[2]},${a*.3})`;};
const fmt=n=>{if(n==null||isNaN(n))return"—";return Math.abs(n)>=1e5?(n/1e3).toFixed(0)+"K":Number(n.toFixed(4)).toString();};

// ── MAPPING ENGINE ──────────────────────────────────────
function buildLookup(data,from,to){const m={};data.forEach(r=>{if(r[from]!=null&&r[to]!=null)m[String(r[from])]=String(r[to]);});return m;}
function findMappingChains(wb,targetKeys,sigCols){
  const missing=targetKeys.filter(k=>!sigCols.includes(k)),chains={};
  missing.forEach(tk=>{for(const[sn,sd]of Object.entries(wb.sheets)){if(!sd.length)continue;const cols=Object.keys(sd[0]);if(!cols.includes(tk))continue;
    for(const bc of cols){if(bc===tk)continue;if(sigCols.includes(bc)){if(!chains[tk])chains[tk]=[];chains[tk].push({type:"direct",signalCol:bc,bridgeSheet:sn,bridgeFrom:bc,bridgeTo:tk,label:`${bc}→${tk} via ${sn}`});}}}});
  return{missing,chains};
}
function applyMappings(data,mappings,wb){let r=data.map(row=>({...row}));for(const[tk,m]of Object.entries(mappings)){if(m?.type==="direct"){const lu=buildLookup(wb.sheets[m.bridgeSheet],m.bridgeFrom,m.bridgeTo);r=r.map(row=>({...row,[tk]:lu[String(row[m.signalCol])]??null}));}}return r;}

// ── UPLOAD ──────────────────────────────────────────────
function UploadScreen({onData}){
  const[drag,setDrag]=useState(false);const ref=useRef();
  const process=async file=>{const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:"array"});const sheets={};wb.SheetNames.forEach(n=>{sheets[n]=XLSX.utils.sheet_to_json(wb.Sheets[n],{defval:null});});onData({sheets,sheetNames:wb.SheetNames,fileName:file.name});};
  return(<div style={{background:T.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${T.bg}}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}select option{background:${T.bgCard};color:${T.text}}`}</style>
    <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"32px"}}>
      <div style={{width:40,height:40,borderRadius:"10px",background:`linear-gradient(135deg,${T.accent},${T.blue})`,display:"flex",alignItems:"center",justifyContent:"center"}}><Crosshair size={20} style={{color:"#fff"}}/></div>
      <div><div style={{fontSize:"20px",fontFamily:T.fontSans,fontWeight:700,color:T.text}}>Signal Correlation Explorer</div>
        <div style={{fontSize:"12px",fontFamily:T.font,color:T.textMuted}}>11 methods · ML · Multi-sheet auto-join</div></div></div>
    <div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);process(e.dataTransfer.files[0]);}}
      onClick={()=>ref.current?.click()}
      style={{width:"100%",maxWidth:"520px",border:`2px dashed ${drag?T.accent:T.border}`,borderRadius:"16px",padding:"50px 30px",textAlign:"center",cursor:"pointer",background:drag?T.accentDim:T.bgCard}}>
      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" onChange={e=>process(e.target.files[0])} style={{display:"none"}}/>
      <UploadCloud size={38} style={{color:drag?T.accent:T.textDim,marginBottom:12}}/><div style={{fontFamily:T.fontSans,fontSize:"15px",fontWeight:600,color:T.text,marginBottom:6}}>Drop your workbook</div>
      <div style={{fontFamily:T.fontSans,fontSize:"12px",color:T.textMuted}}>Multi-sheet with automatic join chain detection</div></div></div>);
}

// ── CONFIG ──────────────────────────────────────────────
function ConfigScreen({wb,onConfigure}){
  const[tSheet,setTSheet]=useState(wb.sheetNames[0]);const[tCol,setTCol]=useState("");const[timeCol,setTimeCol]=useState("");
  const[grainCols,setGrainCols]=useState([]);const[signals,setSignals]=useState([]);
  const[adding,setAdding]=useState(false);const[nS,setNS]=useState("");const[nC,setNC]=useState("");const[nMap,setNMap]=useState({});
  const tData=useMemo(()=>wb.sheets[tSheet]||[],[wb,tSheet]);const tCols=useMemo(()=>tData.length?Object.keys(tData[0]):[],[tData]);
  const tNum=useMemo(()=>tCols.filter(c=>tData.slice(0,20).some(r=>typeof r[c]==="number")),[tCols,tData]);
  const nData=useMemo(()=>nS?wb.sheets[nS]||[]:[], [wb,nS]);const nCols=useMemo(()=>nData.length?Object.keys(nData[0]):[],[nData]);
  const nNum=useMemo(()=>nCols.filter(c=>nData.slice(0,20).some(r=>typeof r[c]==="number")),[nCols,nData]);
  const joinKeys=useMemo(()=>[...(timeCol?[timeCol]:[]),...grainCols],[timeCol,grainCols]);
  const chainInfo=useMemo(()=>nS&&joinKeys.length?findMappingChains(wb,joinKeys,nS,nCols):{missing:[],chains:{}},[wb,joinKeys,nS,nCols]);
  const effMap=useMemo(()=>{const m={...nMap};chainInfo.missing.forEach(k=>{if(!m[k]&&chainInfo.chains[k]?.length)m[k]=chainInfo.chains[k][0];});return m;},[nMap,chainInfo]);
  const addSig=()=>{if(!nS||!nC)return;setSignals(s=>[...s,{sheet:nS,valueCol:nC,directKeys:joinKeys.filter(k=>nCols.includes(k)),mappings:{...effMap},label:`${nC} (${nS})`}]);setAdding(false);setNS("");setNC("");setNMap({});};
  const handleRun=()=>{
    const agg={};tData.forEach(r=>{const k=joinKeys.map(c=>String(r[c]??"")).join("||");if(!agg[k])agg[k]={...Object.fromEntries(joinKeys.map(c=>[c,r[c]])),__t:0};agg[k].__t+=Number(r[tCol])||0;});
    let merged=Object.values(agg);const sN=[];
    signals.forEach((sig,i)=>{let sd=applyMappings(wb.sheets[sig.sheet]||[],sig.mappings,wb);const name=sig.valueCol.replace(/\W/g,"")+"_"+i;sN.push({name,label:sig.label,color:SC[i%SC.length]});
      const sa={};sd.forEach(r=>{const k=joinKeys.map(c=>String(r[c]??"")).join("||");if(k.includes("null")||k.includes("undefined"))return;sa[k]=(sa[k]||0)+(Number(r[sig.valueCol])||0);});
      merged=merged.map(r=>{const k=joinKeys.map(c=>String(r[c]??"")).join("||");return{...r,[name]:sa[k]||0};});});
    merged=merged.map(({__t,...rest})=>({...rest,[tCol]:__t}));
    onConfigure({data:merged,targetCol:tCol,signalNames:sN,grainCols,timeCol,joinKeys});};
  const ok=tCol&&signals.length>0&&joinKeys.length>0;
  return(<div style={{background:T.bg,minHeight:"100vh",padding:"40px",display:"flex",flexDirection:"column",alignItems:"center"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}select option{background:${T.bgCard};color:${T.text}}`}</style>
    <div style={{maxWidth:"750px",width:"100%"}}>
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"24px"}}><Crosshair size={20} style={{color:T.accent}}/><div style={{fontFamily:T.fontSans,fontSize:"18px",fontWeight:700,color:T.text}}>Configure</div><Badge text={wb.fileName} color={T.textMuted}/></div>
      <div style={{...crdS,marginBottom:"14px"}}><div style={{...lbS,marginBottom:"10px"}}><Target size={12} style={{marginRight:4}}/> Target</div>
        <div style={{display:"flex",gap:"12px",flexWrap:"wrap",marginBottom:"10px"}}><Sel label="Sheet" value={tSheet} options={wb.sheetNames.map(s=>({value:s,label:`${s} (${(wb.sheets[s]||[]).length})`}))} onChange={s=>{setTSheet(s);setTCol("");setTimeCol("");setGrainCols([]);setSignals([]);}} width="250px"/>
          <Sel label="Value" value={tCol} options={[{value:"",label:"Select..."},...tNum.map(c=>({value:c,label:c}))]} onChange={setTCol} width="200px"/></div>
        <div style={{...lbS,fontSize:"9px",marginBottom:"4px"}}>Time Column</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:"4px",marginBottom:"8px"}}>{tCols.filter(c=>c!==tCol).map(c=><Chip key={c} label={c} active={timeCol===c} color={T.accent} onClick={()=>setTimeCol(timeCol===c?"":c)}/>)}</div>
        <div style={{...lbS,fontSize:"9px",marginBottom:"4px"}}>Grain Columns</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:"4px"}}>{tCols.filter(c=>c!==timeCol&&c!==tCol).map(c=><Chip key={c} label={c} active={grainCols.includes(c)} color={T.blue} onClick={()=>setGrainCols(g=>g.includes(c)?g.filter(x=>x!==c):[...g,c])}/>)}</div>
        {joinKeys.length>0&&<div style={{marginTop:"6px",fontFamily:T.font,fontSize:"10px",color:T.textMuted}}>Join: <span style={{color:T.accent}}>{joinKeys.join(" × ")}</span></div>}</div>
      <div style={{...crdS,marginBottom:"14px"}}><div style={{...lbS,marginBottom:"10px"}}><Layers size={12} style={{marginRight:4}}/> Signals</div>
        {signals.map((s,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 12px",marginBottom:"6px",borderRadius:T.r,background:T.bgSurface,border:`1px solid ${T.border}`}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:SC[i%SC.length]}}/><div style={{flex:1}}><div style={{fontFamily:T.fontSans,fontSize:"12px",color:T.text,fontWeight:600}}>{s.valueCol}</div>
            <div style={{fontFamily:T.font,fontSize:"10px",color:T.textDim}}>from {s.sheet} · mapped: {Object.entries(s.mappings).filter(([,v])=>v).map(([k,v])=>`${v.signalCol}→${k}`).join(", ")||"direct"}</div></div>
          <button onClick={()=>setSignals(x=>x.filter((_,j)=>j!==i))} style={{background:"transparent",border:"none",cursor:"pointer",color:T.textDim}}><Trash2 size={14}/></button></div>))}
        {!adding?<button onClick={()=>{setAdding(true);setNS(wb.sheetNames.find(s=>s!==tSheet)||wb.sheetNames[0]);}} style={{display:"flex",alignItems:"center",gap:"5px",padding:"8px",borderRadius:T.r,border:`1px dashed ${T.border}`,background:"transparent",color:T.textMuted,fontFamily:T.fontSans,fontSize:"12px",cursor:"pointer",width:"100%",justifyContent:"center"}}><Plus size={14}/> Add Signal</button>
        :<div style={{padding:"12px",borderRadius:T.r,background:T.bgSurface,border:`1px solid ${T.accent}30`}}>
          <div style={{display:"flex",gap:"10px",marginBottom:"10px"}}><Sel label="Sheet" value={nS} options={wb.sheetNames.map(s=>({value:s,label:s}))} onChange={s=>{setNS(s);setNC("");setNMap({});}} width="220px"/>
            <Sel label="Value" value={nC} options={[{value:"",label:"Select..."},...nNum.map(c=>({value:c,label:c}))]} onChange={setNC} width="200px"/></div>
          {joinKeys.length>0&&nS&&<div style={{marginBottom:"10px"}}><div style={{...lbS,fontSize:"9px",marginBottom:"6px"}}><Link2 size={10} style={{marginRight:3}}/>Column Mapping</div>
            {joinKeys.map(tk=>{const direct=nCols.includes(tk);const opts=chainInfo.chains[tk]||[];const sel=effMap[tk];return(
              <div key={tk} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"5px",padding:"5px 8px",borderRadius:"5px",background:direct?T.accent+"10":opts.length?T.orange+"10":T.red+"10",border:`1px solid ${direct?T.accent+"30":opts.length?T.orange+"30":T.red+"30"}`}}>
                <span style={{fontFamily:T.font,fontSize:"11px",color:T.accent,minWidth:"110px",fontWeight:600}}>{tk}</span>
                {direct?<><Check size={13} style={{color:T.green}}/><span style={{fontFamily:T.font,fontSize:"10px",color:T.green}}>Direct match</span></>
                :opts.length?<><Link2 size={12} style={{color:T.orange}}/><select value={JSON.stringify(sel||"")} onChange={e=>setNMap(m=>({...m,[tk]:e.target.value?JSON.parse(e.target.value):null}))}
                  style={{background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:"5px",padding:"3px 6px",color:T.text,fontFamily:T.fontSans,fontSize:"10px",flex:1,outline:"none"}}>{opts.map((ch,ci)=><option key={ci} value={JSON.stringify(ch)}>{ch.label}</option>)}<option value="">— skip —</option></select></>
                :<><AlertTriangle size={12} style={{color:T.red}}/><span style={{fontFamily:T.font,fontSize:"10px",color:T.red}}>No mapping — will aggregate without</span></>}
              </div>);})}</div>}
          <div style={{display:"flex",gap:"8px"}}><button onClick={addSig} disabled={!nC} style={{padding:"6px 14px",borderRadius:"6px",border:"none",background:nC?T.accent:T.border,color:nC?"#000":T.textDim,fontFamily:T.fontSans,fontSize:"12px",fontWeight:600,cursor:nC?"pointer":"default"}}><Check size={12} style={{marginRight:3}}/> Add</button>
            <button onClick={()=>setAdding(false)} style={{padding:"6px 14px",borderRadius:"6px",border:`1px solid ${T.border}`,background:"transparent",color:T.textMuted,fontFamily:T.fontSans,fontSize:"12px",cursor:"pointer"}}>Cancel</button></div></div>}</div>
      <button onClick={handleRun} disabled={!ok} style={{width:"100%",padding:"12px",borderRadius:"8px",border:"none",background:ok?T.accent:T.border,color:ok?"#000":T.textDim,fontFamily:T.fontSans,fontSize:"14px",fontWeight:700,cursor:ok?"pointer":"default",opacity:ok?1:.5}}>Analyze →</button>
    </div></div>);
}

// ── DASHBOARD ───────────────────────────────────────────
const SC=[T.blue,T.orange,T.purple,T.pink,T.cyan,T.yellow,T.green,T.red];

function Dashboard({config,onReset}){
  const{data,targetCol,signalNames,grainCols,timeCol,joinKeys}=config;
  const[selIdx,setSelIdx]=useState(0);const[maxLag,setMaxLag]=useState(12);const[selGrain,setSelGrain]=useState("__all__");
  const[tab,setTab]=useState("metrics");const[mlDone,setMlDone]=useState(null);const[mlRunning,setMlRunning]=useState(false);
  const[testResults,setTestResults]=useState(null);

  const grainOpts=useMemo(()=>{if(!grainCols.length)return[{value:"__all__",label:"All"}];const ps=new Set();data.forEach(r=>{const p=grainCols.map(c=>r[c]).join(" / ");ps.add(p);});return[{value:"__all__",label:`All (${ps.size})`},...[...ps].sort().map(p=>({value:p,label:p}))]},[data,grainCols]);
  const fd=useMemo(()=>selGrain==="__all__"?data:data.filter(r=>grainCols.map(c=>r[c]).join(" / ")===selGrain),[data,selGrain,grainCols]);
  const sel=signalNames[selIdx]||signalNames[0];
  const getArr=useCallback(sn=>{const x=[],y=[];fd.forEach(r=>{const xv=Number(r[sn]),yv=Number(r[targetCol]);if(!isNaN(xv)&&!isNaN(yv)){x.push(xv);y.push(yv);}});return{x,y};},[fd,targetCol]);

  // Full metrics for all signals
  const metrics=useMemo(()=>{
    const m={};signalNames.forEach(sig=>{
      const{x,y}=getArr(sig.name);if(x.length<10){m[sig.name]={n:x.length};return;}
      const pe=pearson_r(x,y),sp=STAT.spearman(x,y),ke=STAT.kendall(x,y);
      const dc=STAT.dCor(x,y), mi=STAT.mutualInfo(x,y);
      const perm=x.length<200?STAT.permTest(x,y,299):pe.p; // permutation for small n
      const ci=STAT.bootstrapCI(x,y,299);
      const lr=linReg2(x,y);
      const ccfRes=STAT.ccf(x,y,maxLag);const best=ccfRes.reduce((b,c)=>Math.abs(c.r)>Math.abs(b.r)?c:b,{lag:0,r:0});
      const acfX=STAT.acf(x,5), acfY=STAT.acf(y,5);
      const adfX=STAT.adfTest(x), adfY=STAT.adfTest(y);
      const lw=STAT.lowess(x,y,0.3);
      const gr=STAT.granger(y,x,Math.min(8,Math.floor(x.length/5)));
      m[sig.name]={n:x.length,pr:pe.r,pp:pe.p,sr:sp.r,sp:sp.p,kt:ke.tau,kp:ke.p,
        dc,mi,permP:perm,ciLo:ci.lo,ciHi:ci.hi,slope:lr.slope,int:lr.intercept,
        ccf:ccfRes,best,acfSig:acfX[1],acfTgt:acfY[1],adfSig:adfX,adfTgt:adfY,
        lowess:lw,granger:gr};
    });return m;
  },[signalNames,getArr,maxLag]);

  function pearson_r(x,y){return STAT.pearson(x,y);}
  function linReg2(x,y){const n=x.length,mx=STAT.mean(x),my=STAT.mean(y);let nm=0,dn=0;for(let i=0;i<n;i++){nm+=(x[i]-mx)*(y[i]-my);dn+=(x[i]-mx)**2;}const s=dn?nm/dn:0;return{slope:s,intercept:my-s*mx};}

  const sd=useMemo(()=>{const{x,y}=getArr(sel.name);return x.map((xv,i)=>({x:xv,y:y[i]}));},[sel,getArr]);
  const sm=metrics[sel.name]||{};
  const tl=useMemo(()=>{if(!sm.slope&&sm.slope!==0)return[];const xs=sd.map(d=>d.x);if(!xs.length)return[];return[{x:Math.min(...xs),y:sm.slope*Math.min(...xs)+sm.int},{x:Math.max(...xs),y:sm.slope*Math.max(...xs)+sm.int}];},[sd,sm]);
  const ts=useMemo(()=>fd.slice(0,300).map((r,i)=>({idx:timeCol?String(r[timeCol]):i,target:Number(r[targetCol])||0,...Object.fromEntries(signalNames.map(s=>[s.name,Number(r[s.name])||0]))})),[fd,timeCol,targetCol,signalNames]);

  // ML run
  const runML=useCallback(()=>{
    setMlRunning(true);
    setTimeout(()=>{
      try{
        const{x:tx,y:ty}=getArr(sel.name);
        // Build feature matrix with lags for ALL signals
        const featureNames=[]; const Xrows=[];
        const allSigArrays=signalNames.map(s=>getArr(s.name));
        const n=ty.length; const maxL=4;
        for(let i=maxL;i<n;i++){
          const row=[];
          signalNames.forEach((s,si)=>{
            for(let l=1;l<=maxL;l++){row.push(allSigArrays[si].x[i-l]);if(i===maxL)featureNames.push(`${s.label}_lag${l}`);}
          });
          // PMI own lags
          for(let l=1;l<=maxL;l++){row.push(ty[i-l]);if(i===maxL)featureNames.push(`Target_lag${l}`);}
          Xrows.push(row);
        }
        const ySlice=ty.slice(maxL);
        // Full model
        const fullModel=ML.fitGBM(Xrows,ySlice,60,0.1);
        const fullPreds=ML.predictGBM(fullModel,Xrows);
        const fullRMSE=ML.rmse(ySlice,fullPreds);
        // Importance
        const imp=ML.permImportance(fullModel,Xrows,ySlice,3);
        const ranked=featureNames.map((f,i)=>({feature:f,importance:imp[i]})).sort((a,b)=>b.importance-a.importance);
        // Walk-forward: baseline (target lags only) vs each signal added
        const targetFeatIdx=featureNames.map((f,i)=>f.startsWith("Target_")?i:null).filter(i=>i!==null);
        const baselineRMSE=ML.walkForward(Xrows,ySlice,targetFeatIdx,4,20);
        const sigLifts={};
        signalNames.forEach(s=>{
          const sigIdx=featureNames.map((f,i)=>f.startsWith(s.label)?i:null).filter(i=>i!==null);
          const combinedIdx=[...targetFeatIdx,...sigIdx];
          const sigRMSE=ML.walkForward(Xrows,ySlice,combinedIdx,4,20);
          sigLifts[s.name]={rmse:sigRMSE,lift:((sigRMSE-baselineRMSE)/baselineRMSE*100)};
        });
        setMlDone({ranked,fullRMSE,baselineRMSE,sigLifts,featureNames});
      }catch(e){setMlDone({error:e.message});}
      setMlRunning(false);
    },100);
  },[getArr,signalNames,sel]);

  const TABS=[{id:"metrics",label:"All Metrics",icon:Grid3X3},{id:"scatter",label:"Scatter + LOWESS",icon:Crosshair},{id:"ccf",label:"CCF + Granger",icon:GitBranch},{id:"ml",label:"ML Analysis",icon:Brain},{id:"tests",label:"Test Suite",icon:TestTube2}];

  return(
    <div style={{background:T.bg,color:T.text,fontFamily:T.fontSans,minHeight:"100vh"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:${T.bg}}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}select option{background:${T.bgCard};color:${T.text}}`}</style>
      {/* Header */}
      <div style={{background:T.bgCard,borderBottom:`1px solid ${T.border}`,padding:"10px 22px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px"}}><Crosshair size={16} style={{color:T.accent}}/><span style={{fontSize:"14px",fontWeight:700}}>Signal Explorer</span>
          <Badge text={`${fd.length} rows`} color={T.textMuted}/><Badge text={joinKeys.join("×")} color={T.purple}/></div>
        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          {grainOpts.length>1&&<Sel value={selGrain} options={grainOpts} onChange={setSelGrain} width="180px"/>}
          <button onClick={onReset} style={{background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:"6px",padding:"5px 10px",cursor:"pointer",color:T.textMuted,fontFamily:T.fontSans,fontSize:"11px"}}><RefreshCw size={11}/></button></div></div>
      {/* Signal bar */}
      <div style={{padding:"8px 22px",display:"flex",gap:"5px",flexWrap:"wrap",borderBottom:`1px solid ${T.border}`,background:T.bgSurface}}>
        {signalNames.map((sig,i)=>{const m=metrics[sig.name]||{};const a=i===selIdx;return(
          <button key={i} onClick={()=>setSelIdx(i)} style={{padding:"4px 10px",borderRadius:"6px",border:`1px solid ${a?sig.color:T.border}`,background:a?sig.color+"20":"transparent",color:a?sig.color:T.textMuted,fontFamily:T.fontSans,fontSize:"11px",fontWeight:a?600:400,cursor:"pointer",display:"flex",alignItems:"center",gap:"5px"}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:sig.color}}/>{sig.label}
            {m.pr!=null&&<span style={{fontFamily:T.font,fontSize:"9px",color:corrColor(m.pr)}}>r={m.pr?.toFixed(3)}</span>}</button>);})}
      </div>
      {/* Tabs */}
      <div style={{padding:"8px 22px 0",display:"flex",gap:"2px",borderBottom:`1px solid ${T.border}`}}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"7px 14px",borderRadius:"6px 6px 0 0",border:"none",borderBottom:tab===t.id?`2px solid ${T.accent}`:"2px solid transparent",background:tab===t.id?T.bgCard:"transparent",color:tab===t.id?T.text:T.textMuted,fontFamily:T.fontSans,fontSize:"11px",cursor:"pointer",display:"flex",alignItems:"center",gap:"4px"}}><t.icon size={12}/>{t.label}</button>)}
      </div>

      <div style={{padding:"16px 22px",display:"flex",flexDirection:"column",gap:"14px"}}>

        {/* TAB: ALL METRICS */}
        {tab==="metrics"&&<>
          <div style={crdS}>
            <div style={{...lbS,marginBottom:"8px"}}><Grid3X3 size={12} style={{marginRight:4}}/> Complete Dependence Matrix — 11 Methods</div>
            <div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",fontFamily:T.font,fontSize:"10px",width:"100%"}}>
              <thead><tr>{["Signal","N","Pearson","p","Spearman","p","Kendall","dCor","MI","Perm p","CI","ACF","ADF","Granger p","Best Lag","Verdict"].map(h=>
                <th key={h} style={{padding:"4px 6px",textAlign:"center",color:T.textMuted,borderBottom:`1px solid ${T.border}`,fontSize:"8px",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
              <tbody>{signalNames.map((sig,i)=>{const m=metrics[sig.name]||{};const a=i===selIdx;
                const nCrit=[Math.abs(m.pr||0)>.15,Math.abs(m.sr||0)>.15,(m.dc||0)>.15,(m.mi||0)>.05,m.granger?.significant,m.best?.lag<0&&Math.abs(m.best?.r||0)>.1,(m.permP||1)<.05].filter(Boolean).length;
                const verdict=nCrit>=4?"PASS":nCrit>=2?"INVESTIGATE":"FAIL";const vc=verdict==="PASS"?T.green:verdict==="INVESTIGATE"?T.orange:T.red;
                return(<tr key={i} onClick={()=>setSelIdx(i)} style={{cursor:"pointer",background:a?T.accentDim:"transparent"}} onMouseEnter={e=>{if(!a)e.currentTarget.style.background=T.bgHover}} onMouseLeave={e=>{if(!a)e.currentTarget.style.background="transparent"}}>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:"3px"}}><div style={{width:5,height:5,borderRadius:"50%",background:sig.color}}/><span style={{fontSize:"9px"}}>{sig.label.length>16?sig.label.slice(0,16)+"…":sig.label}</span></td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:T.textDim}}>{m.n||0}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:corrColor(m.pr),fontWeight:600,background:corrBg(m.pr)}}>{m.pr?.toFixed(3)||"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:m.pp<.05?T.green:T.textDim,fontSize:"9px"}}>{m.pp?.toFixed(3)||"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:corrColor(m.sr),fontWeight:600,background:corrBg(m.sr)}}>{m.sr?.toFixed(3)||"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:m.sp<.05?T.green:T.textDim,fontSize:"9px"}}>{m.sp?.toFixed(3)||"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:corrColor(m.kt),fontWeight:600}}>{m.kt?.toFixed(3)||"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:m.dc>.15?T.cyan:T.textDim,fontWeight:600}}>{m.dc?.toFixed(3)||"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:m.mi>.05?T.cyan:T.textDim,fontWeight:600}}>{m.mi?.toFixed(3)||"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:m.permP<.05?T.green:T.textDim}}>{typeof m.permP==="number"?m.permP.toFixed(3):"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",fontSize:"8px",color:T.textDim}}>{m.ciLo!=null?`[${m.ciLo.toFixed(2)},${m.ciHi.toFixed(2)}]`:"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",fontSize:"8px",color:Math.abs(m.acfSig||0)>.3?T.orange:T.textDim}}>{m.acfSig?.toFixed(2)||"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",fontSize:"8px",color:m.adfSig?.stationary?T.green:T.orange}}>{m.adfSig?.stationary?"S":"NS"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:m.granger?.significant?T.green:T.textDim,fontWeight:600}}>{m.granger?.bestP?.toFixed(3)||"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center",color:m.best?.lag<0?T.accent:T.textDim,fontWeight:600}}>{m.best?.lag!=null?`${m.best.lag>0?"+":""}${m.best.lag}`:"—"}</td>
                  <td style={{padding:"4px 6px",borderBottom:`1px solid ${T.border}`,textAlign:"center"}}><Badge text={`${verdict} ${nCrit}/7`} color={vc}/></td>
                </tr>);})}</tbody></table></div>
            <div style={{marginTop:"6px",fontFamily:T.font,fontSize:"8px",color:T.textDim}}>
              dCor = distance correlation · MI = mutual information · Perm = permutation test p-value · ADF: S=stationary · Verdict: ≥4/7 criteria = PASS</div>
          </div>
          {/* Time series */}
          <div style={crdS}><div style={{...lbS,marginBottom:"8px"}}><Activity size={12} style={{marginRight:4}}/> Time Series</div>
            <ResponsiveContainer width="100%" height={170}><ComposedChart data={ts}><CartesianGrid strokeDasharray="3 3" stroke={T.border}/><XAxis dataKey="idx" tick={{fill:T.textDim,fontSize:8,fontFamily:T.font}} stroke={T.border} interval="preserveStartEnd"/><YAxis tick={{fill:T.textDim,fontSize:9,fontFamily:T.font}} stroke={T.border} tickFormatter={v=>fmt(v)}/><Tooltip content={<Tip/>}/>
              <Line dataKey="target" name={targetCol} stroke={T.text} strokeWidth={2} dot={false}/>
              {signalNames.map((s,i)=><Line key={i} dataKey={s.name} name={s.label} stroke={s.color} strokeWidth={i===selIdx?2:1} dot={false} strokeDasharray={i===selIdx?undefined:"4 3"} strokeOpacity={i===selIdx?1:.4}/>)}
            </ComposedChart></ResponsiveContainer></div>
        </>}

        {/* TAB: SCATTER + LOWESS */}
        {tab==="scatter"&&<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
            <div style={crdS}><div style={{...lbS,marginBottom:"8px"}}><Crosshair size={12} style={{marginRight:4}}/> Scatter + Trend <Badge text={`n=${sd.length}`} color={T.textMuted}/></div>
              <ResponsiveContainer width="100%" height={280}><ComposedChart data={sd}><CartesianGrid strokeDasharray="3 3" stroke={T.border}/><XAxis dataKey="x" type="number" tick={{fill:T.textDim,fontSize:9,fontFamily:T.font}} stroke={T.border}/><YAxis dataKey="y" type="number" tick={{fill:T.textDim,fontSize:9,fontFamily:T.font}} stroke={T.border}/>
                <Tooltip content={({active:a,payload:p})=>{if(!a||!p?.length)return null;const d=p[0]?.payload;return(<div style={{background:"#1A2232",border:`1px solid ${T.border}`,borderRadius:"6px",padding:"6px",fontSize:"10px",fontFamily:T.font}}><div>x:{d?.x?.toFixed(1)} y:{d?.y?.toFixed(1)}</div></div>);}}/>
                <Scatter data={sd} fill={sel.color} fillOpacity={.4} r={2}/>{tl.length===2&&<Line data={tl} dataKey="y" stroke={T.accent} strokeWidth={2} strokeDasharray="6 3" dot={false} type="linear" isAnimationActive={false} legendType="none"/>}</ComposedChart></ResponsiveContainer></div>
            <div style={crdS}><div style={{...lbS,marginBottom:"8px"}}><TrendingUp size={12} style={{marginRight:4}}/> LOWESS Smooth</div>
              <ResponsiveContainer width="100%" height={280}><ComposedChart data={sm.lowess||[]}><CartesianGrid strokeDasharray="3 3" stroke={T.border}/><XAxis dataKey="x" type="number" tick={{fill:T.textDim,fontSize:9,fontFamily:T.font}} stroke={T.border}/><YAxis dataKey="y" type="number" tick={{fill:T.textDim,fontSize:9,fontFamily:T.font}} stroke={T.border}/>
                <Tooltip content={<Tip/>}/><Line dataKey="y" name="LOWESS" stroke={T.purple} strokeWidth={2} dot={false}/></ComposedChart></ResponsiveContainer>
              <div style={{fontFamily:T.font,fontSize:"9px",color:T.textDim,marginTop:"4px"}}>LOWESS reveals nonlinear shape that Pearson misses. Curvature = nonlinear relationship.</div></div>
          </div>
          {/* Mini scatter grid */}
          <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(signalNames.length,4)},1fr)`,gap:"12px"}}>
            {signalNames.map((sig,i)=>{const{x,y}=getArr(sig.name);const sd2=x.map((xv,j)=>({x:xv,y:y[j]}));const m=metrics[sig.name]||{};return(
              <div key={i} style={{...crdS,padding:"10px",cursor:"pointer",border:`1px solid ${i===selIdx?sig.color:T.border}`}} onClick={()=>setSelIdx(i)}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}><span style={{fontSize:"10px",fontWeight:600,color:sig.color}}>{sig.label.length>16?sig.label.slice(0,16)+"…":sig.label}</span><span style={{fontFamily:T.font,fontSize:"9px",color:corrColor(m.pr)}}>r={m.pr?.toFixed(3)}</span></div>
                <ResponsiveContainer width="100%" height={90}><ScatterChart><XAxis dataKey="x" type="number" hide/><YAxis dataKey="y" type="number" hide/><Scatter data={sd2} fill={sig.color} fillOpacity={.3} r={1.5}/></ScatterChart></ResponsiveContainer>
                <div style={{display:"flex",justifyContent:"space-between",fontFamily:T.font,fontSize:"8px",color:T.textDim,marginTop:"2px"}}><span>dCor={m.dc?.toFixed(3)}</span><span>MI={m.mi?.toFixed(3)}</span></div></div>);})}
          </div>
        </>}

        {/* TAB: CCF + GRANGER */}
        {tab==="ccf"&&<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
            <div style={crdS}><div style={{...lbS,marginBottom:"8px",display:"flex",justifyContent:"space-between"}}><span><GitBranch size={12} style={{marginRight:4}}/> CCF</span><Sel value={maxLag} options={[4,8,12,16].map(v=>({value:v,label:`±${v}`}))} onChange={v=>setMaxLag(Number(v))} width="60px"/></div>
              <ResponsiveContainer width="100%" height={260}><BarChart data={sm.ccf||[]}><CartesianGrid strokeDasharray="3 3" stroke={T.border}/><XAxis dataKey="lag" tick={{fill:T.textDim,fontSize:9,fontFamily:T.font}} stroke={T.border}/><YAxis tick={{fill:T.textDim,fontSize:9,fontFamily:T.font}} stroke={T.border}/><Tooltip content={({active:a,payload:p})=>{if(!a||!p?.length)return null;const d=p[0]?.payload;return(<div style={{background:"#1A2232",border:`1px solid ${T.border}`,borderRadius:"6px",padding:"6px",fontSize:"10px",fontFamily:T.font}}><div style={{color:corrColor(d?.r)}}>Lag {d?.lag}: r={d?.r?.toFixed(4)}</div></div>);}}/>
                <ReferenceLine y={0} stroke={T.textDim} strokeDasharray="2 2"/><Bar dataKey="r">{(sm.ccf||[]).map((e,i)=><Cell key={i} fill={e.lag<0?T.accent:e.lag>0?T.orange:T.text} opacity={Math.abs(e.r)>.1?.8:.3}/>)}</Bar></BarChart></ResponsiveContainer></div>
            <div style={crdS}><div style={{...lbS,marginBottom:"10px"}}><Shield size={12} style={{marginRight:4}}/> Granger + Stationarity</div>
              <div style={{fontFamily:T.font,fontSize:"11px",lineHeight:2}}>
                <div><span style={{color:T.textMuted}}>ADF (signal):</span> <span style={{color:sm.adfSig?.stationary?T.green:T.red}}>{sm.adfSig?.stationary?"Stationary ✓":"Non-stationary ⚠"}</span> <span style={{color:T.textDim}}>p={sm.adfSig?.p?.toFixed(4)}</span></div>
                <div><span style={{color:T.textMuted}}>ACF lag-1 (signal):</span> <span style={{color:Math.abs(sm.acfSig||0)>.3?T.orange:T.green}}>{sm.acfSig?.toFixed(4)}</span> {Math.abs(sm.acfSig||0)>.3&&<Badge text="HIGH" color={T.orange}/>}</div>
                <div style={{borderTop:`1px solid ${T.border}`,paddingTop:"6px",marginTop:"4px"}}>
                  <span style={{color:T.textMuted}}>Granger:</span> <span style={{color:sm.granger?.significant?T.green:T.red,fontWeight:600}}>{sm.granger?.significant?"CAUSAL ✓":"NOT CAUSAL ✗"}</span></div>
                <div><span style={{color:T.textDim}}>best lag={sm.granger?.bestLag}, p={sm.granger?.bestP?.toFixed(4)}</span></div>
                <div style={{borderTop:`1px solid ${T.border}`,paddingTop:"6px",marginTop:"4px"}}>
                  <span style={{color:T.textMuted}}>Perm test:</span> <span style={{color:typeof sm.permP==="number"&&sm.permP<.05?T.green:T.red}}>{typeof sm.permP==="number"?`p=${sm.permP.toFixed(4)}`:"—"}</span></div>
                <div><span style={{color:T.textMuted}}>95% CI:</span> <span style={{color:T.text}}>[{sm.ciLo?.toFixed(3)}, {sm.ciHi?.toFixed(3)}]</span> {sm.ciLo!=null&&sm.ciLo<=0&&sm.ciHi>=0&&<Badge text="contains 0" color={T.orange}/>}</div>
              </div></div>
          </div>
        </>}

        {/* TAB: ML */}
        {tab==="ml"&&<>
          <div style={crdS}>
            <div style={{...lbS,marginBottom:"10px"}}><Brain size={12} style={{marginRight:4}}/> ML Feature Importance + Walk-Forward</div>
            {!mlDone&&!mlRunning&&<div style={{textAlign:"center",padding:"30px"}}>
              <div style={{fontFamily:T.fontSans,fontSize:"13px",color:T.textMuted,marginBottom:"12px"}}>Trains a gradient boosting model in-browser, computes permutation importance, and runs walk-forward validation to measure lift per signal.</div>
              <button onClick={runML} style={{padding:"10px 24px",borderRadius:"8px",border:"none",background:T.accent,color:"#000",fontFamily:T.fontSans,fontSize:"13px",fontWeight:700,cursor:"pointer"}}><Zap size={14} style={{marginRight:4}}/> Run ML Analysis</button></div>}
            {mlRunning&&<div style={{textAlign:"center",padding:"30px"}}><div style={{color:T.accent,fontSize:"14px",fontFamily:T.fontSans}}>Training model...</div></div>}
            {mlDone&&!mlDone.error&&<>
              <div style={{fontFamily:T.font,fontSize:"11px",color:T.textMuted,marginBottom:"12px"}}>Full model RMSE: {mlDone.fullRMSE.toFixed(1)} | Baseline (target lags only): {mlDone.baselineRMSE.toFixed(1)}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
                <div><div style={{...lbS,fontSize:"9px",marginBottom:"6px"}}>Feature Importance (Top 15)</div>
                  {mlDone.ranked.slice(0,15).map((f,i)=>{const w=f.importance/Math.max(mlDone.ranked[0].importance,.001)*100;return(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px"}}>
                      <span style={{fontFamily:T.font,fontSize:"10px",color:T.text,minWidth:"160px"}}>{i+1}. {f.feature}</span>
                      <div style={{flex:1,height:"8px",background:T.bgSurface,borderRadius:"4px",overflow:"hidden"}}><div style={{width:`${Math.max(w,2)}%`,height:"100%",background:f.feature.startsWith("Target")?T.textMuted:T.accent,borderRadius:"4px"}}/></div>
                      <span style={{fontFamily:T.font,fontSize:"9px",color:T.textDim,minWidth:"40px"}}>{f.importance.toFixed(2)}</span></div>);})}</div>
                <div><div style={{...lbS,fontSize:"9px",marginBottom:"6px"}}>Walk-Forward Lift (vs baseline)</div>
                  <div style={{fontFamily:T.font,fontSize:"11px",lineHeight:2.2}}>
                    <div><span style={{color:T.textMuted}}>Baseline (target lags only):</span> <span style={{color:T.text,fontWeight:600}}>{mlDone.baselineRMSE.toFixed(1)}</span></div>
                    {signalNames.map((s,i)=>{const lift=mlDone.sigLifts[s.name];if(!lift)return null;const improved=lift.lift<-1;return(
                      <div key={i}><span style={{color:s.color}}>+ {s.label}:</span> <span style={{color:improved?T.green:T.textDim,fontWeight:600}}>{lift.rmse.toFixed(1)}</span> <span style={{color:improved?T.green:T.textDim}}>({lift.lift>0?"+":""}{lift.lift.toFixed(1)}%)</span> {improved?<Badge text="LIFT" color={T.green}/>:<Badge text="NO LIFT" color={T.textDim}/>}</div>);})}</div></div>
              </div>
            </>}
            {mlDone?.error&&<div style={{color:T.red,fontSize:"12px"}}>Error: {mlDone.error}</div>}
          </div>
        </>}

        {/* TAB: TESTS */}
        {tab==="tests"&&<>
          <div style={crdS}>
            <div style={{...lbS,marginBottom:"10px"}}><TestTube2 size={12} style={{marginRight:4}}/> Built-in Test Suite</div>
            {!testResults?<div style={{textAlign:"center",padding:"20px"}}>
              <div style={{fontFamily:T.fontSans,fontSize:"13px",color:T.textMuted,marginBottom:"12px"}}>Runs {">"}25 tests validating every statistical method against known values.</div>
              <button onClick={()=>setTestResults(runTests())} style={{padding:"10px 24px",borderRadius:"8px",border:"none",background:T.blue,color:"#fff",fontFamily:T.fontSans,fontSize:"13px",fontWeight:700,cursor:"pointer"}}><FlaskConical size={14} style={{marginRight:4}}/> Run Tests</button></div>
            :<>
              <div style={{marginBottom:"10px",fontFamily:T.font,fontSize:"12px"}}>
                <span style={{color:T.green}}>{testResults.filter(t=>t.ok).length} passed</span> / <span style={{color:T.red}}>{testResults.filter(t=>!t.ok).length} failed</span> / {testResults.length} total
                {testResults.every(t=>t.ok)&&<Badge text="ALL PASSED ✓" color={T.green}/>}
              </div>
              <div style={{maxHeight:"400px",overflowY:"auto"}}>
                {testResults.map((t,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:"6px",padding:"4px 8px",marginBottom:"2px",borderRadius:"4px",background:t.ok?"transparent":T.redDim}}>
                    {t.ok?<Check size={12} style={{color:T.green,flexShrink:0}}/>:<AlertTriangle size={12} style={{color:T.red,flexShrink:0}}/>}
                    <span style={{fontFamily:T.font,fontSize:"10px",color:t.ok?T.textMuted:T.red}}>{t.name}</span>
                    {t.detail&&<span style={{fontFamily:T.font,fontSize:"9px",color:T.textDim,marginLeft:"auto"}}>{t.detail}</span>}
                  </div>))}
              </div>
              <button onClick={()=>setTestResults(null)} style={{marginTop:"8px",padding:"6px 14px",borderRadius:"6px",border:`1px solid ${T.border}`,background:"transparent",color:T.textMuted,fontFamily:T.fontSans,fontSize:"11px",cursor:"pointer"}}>Reset</button>
            </>}
          </div>
        </>}

        {/* Method reference */}
        <div style={{...crdS,padding:"12px 14px",background:T.bgSurface}}>
          <div style={{...lbS,marginBottom:"4px"}}><Info size={10} style={{marginRight:3}}/> Methods</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"4px",fontFamily:T.font,fontSize:"8px"}}>
            <div><span style={{color:T.accent}}>Pearson</span> <span style={{color:T.textDim}}>linear</span></div>
            <div><span style={{color:T.blue}}>Spearman</span> <span style={{color:T.textDim}}>monotonic</span></div>
            <div><span style={{color:T.purple}}>Kendall</span> <span style={{color:T.textDim}}>rank</span></div>
            <div><span style={{color:T.cyan}}>dCor</span> <span style={{color:T.textDim}}>any dependence</span></div>
            <div><span style={{color:T.cyan}}>MI</span> <span style={{color:T.textDim}}>nonlinear</span></div>
            <div><span style={{color:T.green}}>Granger</span> <span style={{color:T.textDim}}>causal</span></div>
            <div><span style={{color:T.orange}}>LOWESS</span> <span style={{color:T.textDim}}>shape</span></div>
            <div><span style={{color:T.yellow}}>GBM+SHAP</span> <span style={{color:T.textDim}}>ML importance</span></div>
          </div>
        </div>
      </div></div>);
}

export default function App(){const[wb,setWb]=useState(null);const[config,setConfig]=useState(null);
  if(!wb)return<UploadScreen onData={setWb}/>;if(!config)return<ConfigScreen wb={wb} onConfigure={setConfig}/>;
  return<Dashboard config={config} onReset={()=>{setConfig(null);setWb(null);}}/>;
}
