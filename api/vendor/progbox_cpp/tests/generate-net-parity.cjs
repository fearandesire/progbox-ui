// Regenerate intentional golden changes from the real NET scripts and pinned
// BBGM helper harness. Usage: node generate-net-parity.cjs candidate.js published.js helpers/run-script.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const [candidatePath, publishedPath, helperPath] = process.argv.slice(2).map(p => path.resolve(p));
const { keys, limitRating, ovr } = require(helperPath);
const candidate = fs.readFileSync(candidatePath, 'utf8');
const published = fs.readFileSync(publishedPath, 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(published) !== '9740457fbd83e76a0db7f0641bf3bd2e90a7d7c09c0b6fe612231755e5159b09') {
  throw new Error('Published source differs from pinned NET commit 972f9d3');
}
const cases = [];
const base = { per: 15, gp: 82, min: 24 };
const statsKeys = ['per','gp','min','availability','obpm','dbpm','stlp','blkp','usgp','astp','trbp','orbp','ortg','fga','fta','tpa','tp','ft','fgaAtRim','fgAtRim','fgaLowPost','fgLowPost','fgaMidRange','fgMidRange','orb','tov'];
const stats = values => Object.fromEntries(statsKeys.map(k => [k, values[k] ?? 0]));
function add(name, version, age, per = 15, rating = 50, draws = [], drawFallback = .5, extras = {}) {
  const s = stats({...base, per, ...extras.stats});
  cases.push({name, version, age, attrs:Array(15).fill(rating), stats:s, pool:[s], draws, drawFallback, ...extras});
}
// Integer/floor/clamp and the complete soft-ceiling band, with zero noise draws.
for (const [name, age, rating] of [['floor-age30',30,50],['lower-clamp',42,0],['upper-clamp',25,100],['fractional-base',30,50.75],['under25-preserved',24,50]]) {
  add(`candidate-${name}`, 'v43', age,15,rating);
}
for (const rating of [71,72,73,74,75,76,77,78]) add(`candidate-ceiling-rating${rating}`,'v43',25,25,rating,[],.9);
for (const per of [-5,0]) add(`candidate-per${per}-preserved`,'v43',30,per);
add('candidate-god-low','v43',25,15,25,[0,0]);
add('candidate-god-high','v43',29,15,25,[0,.999999]);
add('candidate-god-physical-bypass','v43',29,15,50,[0,.75],.99);
add('candidate-god-upper-clamp','v43',25,15,99,[0,.999999]);
const rich = stats({...base,per:25,obpm:5,dbpm:3,astp:30,stlp:3,blkp:5,trbp:20,orbp:10,usgp:30,ortg:125,availability:1,fga:18,fta:8,tpa:8,tp:3,ft:7,fgaAtRim:6,fgAtRim:4,fgaLowPost:2,fgLowPost:1,fgaMidRange:2,fgMidRange:1,orb:3,tov:3});
const low = stats({...base,per:-5,gp:20,min:8,obpm:-5,dbpm:-3,astp:10,stlp:1,blkp:1,trbp:5,orbp:2,usgp:10,ortg:80,availability:.25,fga:6,fta:2,tpa:1,tp:.25,ft:1,fgaAtRim:2,fgAtRim:.5,fgaLowPost:1,fgLowPost:.25,fgaMidRange:2,fgMidRange:.5,orb:1,tov:2});
for (const min of [0,7.75,8,24]) add(`candidate-pool-min${min}`,'v43',32,25,50,[.25,.1,.2,.3,.4,.5,.6,.7,.8,.9,.99,.01,.8,.4,.2],.5,{stats:{...rich,min},pool:[{...rich,min},low,{...low,min:7.75},{...low,min:0,gp:0}]});
for (const attempts of [19,20,21]) add(`candidate-attempts${attempts}`,'v43',30,25,50,[],.5,{stats:{...rich,gp:1,tpa:attempts,tp:attempts/2},pool:[{...rich,gp:1,tpa:attempts,tp:attempts/2},low]});
// Published branches: physical chances, shared range mutation, || 2 fallback,
// cap randomMin semantics (all possible integer outcomes satisfy < .02), gods.
for (const age of [25,29,30,31,34,35,42]) for (const per of [-5,1,8,12,15,20,21,35,50]) {
  add(`published-age${age}-per${per}`,'v321',age,per);
}
add('published-zero-per-preserved','v321',30,0);
add('published-old-physical-skip','v321',31,15,50,[],0);
add('published-shared-max-mutation','v321',30,35,50,[.99,.99,.99,.5,0,.99],.99);
add('published-old-physical-no-cap','v321',30,35,50,[],.99);
for (const value of [0,.5,.999999]) add(`published-cap-randomMin-${value}`,'v321',30,50,95,[value],.5);
for (const age of [31,35]) add(`published-over80-age${age}`,'v321',age,15,95);
add('published-approaching80','v321',30,50,72);
add('published-god-low','v321',25,15,25,[0,0]);
add('published-god-high','v321',29,15,25,[0,.999999]);
add('published-god-physical-slowdown','v321',29,15,50,[0,.75],.99);
add('published-god-upper-clamp','v321',25,15,99,[.5,0,.999999]);
add('published-fractional-base','v321',30,15,50.75);
add('published-lower-clamp','v321',42,1,0,[],0);
for(const age of [25,31,35]) for(const per of [60,100]) add(`published-extreme-per${per}-age${age}`,'v321',age,per,50);

// OVR chance discontinuities and exact threshold equality, using actual BBGM OVR.
for (const target of [29,30,60,61,62,80,82]) {
  let attrs;
  for(let value=0;value<=100&&!attrs;value++) for(let hgt=0;hgt<=100;hgt++) {
    const candidateAttrs=Array(15).fill(value); candidateAttrs[14]=hgt;
    if(ovr(Object.fromEntries(keys.map((k,i)=>[k,candidateAttrs[i]])))===target) {attrs=candidateAttrs;break;}
  }
  if(!attrs) throw new Error(`Could not construct OVR ${target}`);
  const rating=attrs[0];
  const chance = .09 * (target<30 ? 1 : target>61 ? .01 : 1-(target-30)/31);
  for (const version of ['v321','v43']) {
    add(`${version}-god-boundary-ovr${target}`,version,25,15,rating,target>=80&&version==='v321'?[.5,chance]:[chance],.5,{attrs});
    if(chance>0) add(`${version}-god-below-ovr${target}`,version,25,15,rating,target>=80&&version==='v321'?[.5,chance/2,.999999]:[chance/2,.999999],.5,{attrs});
  }
}

async function evaluate(c) {
  let count = 0, godBonus = null;
  const math = Object.create(Math);
  math.random = () => c.draws[count++] ?? c.drawFallback;
  const ratings = Object.fromEntries(keys.map((key,i) => [key,c.attrs[i]]));
  ratings.ovr = ovr(ratings);
  const player = {pid:1,watch:1,tid:0,firstName:'Golden',lastName:c.name,born:{year:2020-c.age},draft:{year:2010},ratings:[{...ratings,season:2019},{...ratings,season:2020}],stats:[{season:2019,per:c.stats.per}]};
  const bbgm = {
    g:{get:()=>2020}, player:{limitRating,ovr,addRatingsRow:p=>p.ratings.push({...p.ratings.at(-1),season:2020}),develop:async p=>{p.ratings.at(-1).ovr=ovr(p.ratings.at(-1));},updateValues:async()=>{}},
    idb:{cache:{players:{getAll:async()=>[player],put:async()=>{}}}},
    random:{randInt:(min,max)=>Math.floor(math.random()*(max-min+1)+min)},logEvent:async()=>{},helpers:{leagueUrl:()=>''},
  };
  let finalRatings;
  if(c.version==='v43') {
    const context = {Math:math,bbgm,c,ratings};
    vm.createContext(context);
    vm.runInContext(candidate.replace(/await compileProgs\(\);\s*await logGodProgs\(\);\s*$/,'') + '\nconst result=progressPlayer({born:{year:2020-c.age}},c.stats,preparePool(c.pool),ratings); globalThis.god=result?.godProg??false;',context);
    if(context.god) godBonus = Math.floor((c.draws[1]??c.drawFallback)*7)+7;
    finalRatings=ratings;
  } else {
    // Only intercept notifications; execute the actual published progression loop.
    await vm.runInNewContext('(async()=>{'+published.replace('await compileProgs();','sendProgNotification=async data=>{if(data.godProg) captureGod(data.progRange[0]);}; await compileProgs();')+'})()', {Math:math,bbgm,captureGod:value=>{godBonus=value;}});
    finalRatings=player.ratings.at(-1);
  }
  return {attrs:keys.map(k=>finalRatings[k]),ovr:ovr(finalRatings),godBonus,drawCount:count};
}
(async()=>{
  for(const c of cases)c.expected=await evaluate(c);
  const fixtures={references:{publishedCommit:'972f9d3c08476bd91276ea7327b0972dfba3a382',publishedSha256:hash(published),candidateSha256:hash(candidate),bbgmCommit:'0ae7a104d541ad0a4806de083819b19735cbf301'},cases};
  fs.writeFileSync(path.join(__dirname,'net_parity_cases.json'),JSON.stringify(fixtures,null,2)+'\n');
  console.log(`Generated ${cases.length} cases from actual scripts and pinned BBGM helpers`);
})().catch(error=>{console.error(error);process.exitCode=1;});
