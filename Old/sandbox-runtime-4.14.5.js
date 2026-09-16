/* Sandbox-only data adapter. The original app renders and handles every control. */
(() => {
  const seed=window.__UT_SANDBOX_SEED;
  if(!seed) return;
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const now=()=>new Date().toISOString();
  const id=()=>`sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user={id:'sandbox-user',email:'sandbox@example.invalid',user_metadata:{}};
  const s=seed.state;
  const tables={...clone(seed.tables||{}),
    players:s.players.map(p=>({id:p.id,first_name:p.firstName,last_name:p.lastName,full_name:p.fullName,handling:p.handling,cutting:p.cutting,defense:p.defense,win_loss:p.winLossRating,active:p.active,injury_pct:p.injuryPct,temporary:p.temporary,games_played:p.gamesPlayed,wins:p.wins,losses:p.losses})),
    attendance:s.players.map(p=>({player_id:p.id,present:p.attending})),
    pair_rules:s.pairRules.map(r=>({id:r.id,player1_id:r.player1Id,player2_id:r.player2Id,rule_type:r.type,strength:r.strength,created_by:r.createdBy,created_by_role:r.createdByRole})),
    teammate_history:Object.entries(s.history||{}).map(([key,count])=>{const [player_a,player_b]=key.split('|');return {player_a,player_b,count}}),
    settings:[{...clone(seed.settings),id:'main'}],
    current_game:[{id:'main',teams:clone(s.currentGame?.teams||[]),generated_at:s.currentGameGeneratedAt,selected_winner_index:s.selectedWinnerIndex,results_saved:s.resultsSavedForCurrentGame}],
    profiles:[{...clone(seed.profile),id:user.id,email:user.email,role:seed.role||'admin',player_id:seed.playerId||s.players[0]?.id||null}]
  };
  for(const name of ['games','game_player_results','teammate_pair_events','rating_history','admin_audit_logs'])tables[name]??=[];
  const ok=data=>({data:clone(data),error:null});
  const fail=message=>({data:null,error:{message}});
  const getTable=name=>tables[name]??(tables[name]=[]);
  function syncPlayerChoices(){window.parent.postMessage({type:'ut-sandbox-players',players:tables.players.map(p=>({id:p.id,fullName:p.full_name}))},'*')}
  function bootstrap(){return {players:tables.players,attendance:tables.attendance,pair_rules:tables.pair_rules,teammate_history:tables.teammate_history,settings:tables.settings[0],current_game:tables.current_game[0],profile:tables.profiles[0]}}

  // Supabase-compatible, promise-like local table operations. No transport exists.
  class Query {
    constructor(table){this.table=table;this.filters=[];this.sorts=[];this.cap=Infinity;this.start=0;this.mode='select';this.one=false}
    select(){return this}
    eq(k,v){this.filters.push(r=>String(r[k])===String(v));return this}
    neq(k,v){this.filters.push(r=>String(r[k])!==String(v));return this}
    in(k,values){this.filters.push(r=>values.some(v=>String(v)===String(r[k])));return this}
    gte(k,v){this.filters.push(r=>r[k]>=v);return this}
    lte(k,v){this.filters.push(r=>r[k]<=v);return this}
    is(k,v){this.filters.push(r=>v===null?r[k]==null:r[k]===v);return this}
    not(k,op,v){this.filters.push(r=>op==='is'&&v===null?r[k]!=null:String(r[k])!==String(v));return this}
    or(expr){const terms=expr.split(',').map(t=>t.split('.'));this.filters.push(r=>terms.some(([k,op,...v])=>op==='eq'&&String(r[k])===v.join('.')));return this}
    order(k,opts={}){this.sorts.push([k,opts.ascending!==false]);return this}
    limit(n){this.cap=n;return this}
    range(a,b){this.start=a;this.cap=b-a+1;return this}
    single(){this.one=true;return this}
    maybeSingle(){this.one=true;return this}
    insert(data){this.mode='insert';this.payload=clone(data);return this}
    upsert(data,options={}){this.mode='upsert';this.payload=clone(data);this.conflict=options.onConflict;return this}
    update(data){this.mode='update';this.payload=clone(data);return this}
    delete(){this.mode='delete';return this}
    execute(){
      const all=getTable(this.table), match=r=>this.filters.every(f=>f(r));
      let rows=all.filter(match);
      if(this.mode==='insert'||this.mode==='upsert'){
        rows=(Array.isArray(this.payload)?this.payload:[this.payload]).map(value=>{
          const keys=(this.conflict||(this.table==='attendance'?'player_id':this.table==='teammate_history'?'player_a,player_b':'id')).split(',');
          const old=this.mode==='upsert'?all.find(r=>keys.every(k=>value[k]!=null&&String(r[k])===String(value[k]))):null;
          if(old){Object.assign(old,value);return old}
          const added={id:id(),created_at:now(),...value};all.push(added);return added;
        });
      }else if(this.mode==='update'){rows.forEach(r=>Object.assign(r,this.payload));}
      else if(this.mode==='delete'){tables[this.table]=all.filter(r=>!match(r));}
      for(const [key,asc] of [...this.sorts].reverse())rows.sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(asc?1:-1));
      rows=rows.slice(this.start,this.start+this.cap);
      if(this.table==='players'&&this.mode!=='select')syncPlayerChoices();
      return ok(this.one?(rows[0]||null):rows);
    }
    then(resolve,reject){return Promise.resolve().then(()=>this.execute()).then(resolve,reject)}
  }
  function recordPairs(teams,gameId,source){
    for(const team of teams)for(let i=0;i<team.length;i++)for(let j=i+1;j<team.length;j++){
      const [a,b]=[String(team[i].id),String(team[j].id)].sort();
      let row=tables.teammate_history.find(r=>r.player_a===a&&r.player_b===b);
      if(!row){row={player_a:a,player_b:b,count:0};tables.teammate_history.push(row)}
      row.count++;
      tables.teammate_pair_events.push({id:id(),game_id:gameId,player_a:a,player_b:b,source,created_at:now()});
    }
  }
  function saveGame(args,pairingsOnly=false){
    const current=tables.current_game[0];
    if(current.results_saved)return fail('Current game results are already saved.');
    const teams=clone(current.teams?.length?current.teams:args.p_teams||[]);
    const winner=pairingsOnly?null:Number(args.p_winner_team_index);
    if(teams.length<2||(!pairingsOnly&&(!Number.isInteger(winner)||!teams[winner]?.length)))return fail('Select a valid winning team.');
    const playerIds=teams.flat().map(p=>String(p.id));
    if(new Set(playerIds).size!==playerIds.length||playerIds.some(id=>!tables.players.some(p=>String(p.id)===id)))return fail('Invalid game roster.');
    const gameId=id(),playedAt=now();
    if(!pairingsOnly){
      const settings=tables.settings[0],k=Number(settings.k_factor??.08),losers=teams.length-1;
      const strengths=teams.map(team=>team.reduce((sum,member)=>{
        const p=tables.players.find(p=>String(p.id)===String(member.id)),injury=Number(p.injury_pct??1);
        return sum+Number(p.handling)*(0.5+0.5*injury)*Number(settings.weight_handling??.35)+Number(p.cutting)*injury*Number(settings.weight_cutting??.35)+Number(p.defense)*injury*Number(settings.weight_defense??.30)+Number(p.win_loss||0);
      },0));
      const expected=(a,b)=>1/(1+Math.pow(10,(b-a)/4));
      const deltas=strengths.map((strength,i)=>i===winner?strengths.reduce((sum,other,j)=>j===winner?sum:sum+(k/losers)*(1-expected(strength,other)),0):-(k/losers)*expected(strength,strengths[winner]));
      teams.forEach((team,teamIndex)=>team.forEach(member=>{
        const p=tables.players.find(p=>String(p.id)===String(member.id));
        const before={old_win_loss:Number(p.win_loss||0),old_games_played:Number(p.games_played||0),old_wins:Number(p.wins||0),old_losses:Number(p.losses||0)};
        p.win_loss=before.old_win_loss+deltas[teamIndex];p.games_played=before.old_games_played+1;p.wins=before.old_wins+(teamIndex===winner?1:0);p.losses=before.old_losses+(teamIndex===winner?0:1);
        tables.game_player_results.push({id:id(),game_id:gameId,player_id:p.id,team_idx:teamIndex,...before,new_win_loss:p.win_loss,new_games_played:p.games_played,new_wins:p.wins,new_losses:p.losses,delta:deltas[teamIndex]});
        tables.rating_history.push({id:id(),game_id:gameId,player_id:p.id,value:p.win_loss,created_at:playedAt});
      }));
    }
    tables.games.push({id:gameId,teams,winner_team_index:winner,played_at:playedAt,created_by:user.id});
    recordPairs(teams,gameId,pairingsOnly?'pairings_only':'results_saved');
    Object.assign(current,{teams,selected_winner_index:winner,results_saved:true});
    return ok({game_id:gameId,updated_players:playerIds.length});
  }
  async function rpc(name,args={}){
    if(name.startsWith('get_app_bootstrap'))return ok(bootstrap());
    if(name==='mark_attendance_from_app'){
      const p=tables.players.find(p=>String(p.id)===String(args.p_player_id));
      if(!p)return fail('Player not found.');
      if(!canMarkAttendanceForPlayer(p.id))return fail('Players can only mark their own attendance.');
      await new Query('attendance').upsert({player_id:p.id,present:!!args.p_present},{onConflict:'player_id'});
      if(args.p_present)p.active=true;
      return ok(true);
    }
    if(name==='add_player_from_app'){
      if(!canManageGames())return fail('Captain/admin only.');
      const playerId=id(),first=args.p_first_name||'',last=args.p_last_name||'';
      tables.players.push({id:playerId,first_name:first,last_name:last,full_name:`${first} ${last}`.trim(),handling:Number(args.p_handling??3),cutting:Number(args.p_cutting??3),defense:Number(args.p_defense??3),win_loss:0,active:true,injury_pct:1,temporary:!!args.p_temporary,games_played:0,wins:0,losses:0});
      tables.attendance.push({player_id:playerId,present:!!args.p_mark_present});
      syncPlayerChoices();
      return ok({player_id:playerId});
    }
    if(name==='make_temporary_player_permanent_from_app'){
      if(!canManageGames())return fail('Captain/admin only.');
      const p=tables.players.find(p=>String(p.id)===String(args.p_player_id));
      if(!p)return fail('Player not found.');
      p.temporary=false;
      syncPlayerChoices();
      return ok(true);
    }
    if(name==='remove_temporary_player_from_app'){
      const p=tables.players.find(p=>String(p.id)===String(args.p_player_id));
      if(!p?.temporary)return fail('Temporary player not found.');
      if(!canManageGames()&&!isTeammate())return fail('Attendance access required.');
      tables.players=tables.players.filter(row=>row!==p);tables.attendance=tables.attendance.filter(a=>String(a.player_id)!==String(p.id));
      syncPlayerChoices();
      return ok(true);
    }
    if(name==='save_game_results'||name==='save_pairings_only'){
      if(!canManageGames())return fail('Captain/admin only.');
      return saveGame(args,name==='save_pairings_only');
    }
    if(name==='get_saved_result_teammates_4120'){
      const counts={};
      for(const game of tables.games.filter(g=>g.winner_team_index!=null))for(const team of game.teams||[]){
        if(!team.some(p=>String(p.id)===String(args.p_player_id)))continue;
        for(const p of team)if(String(p.id)!==String(args.p_player_id)){
          counts[p.id]??={full_name:p.fullName||p.full_name||'',games_together:0};counts[p.id].games_together++;
        }
      }
      return ok(Object.values(counts).sort((a,b)=>b.games_together-a.games_together).slice(0,10));
    }
    return fail('This history/account administration action is unavailable in the sandbox.');
  }
  const channel={on(){return this},subscribe(){return this},unsubscribe(){}};
  const client={from:name=>new Query(name),rpc,
    auth:{getSession:async()=>ok({session:{user}}),getUser:async()=>ok({user}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>ok(null)},
    channel:()=>channel,removeChannel:async()=>{},removeAllChannels:async()=>{},
    functions:{invoke:async()=>ok({sent:0,sandbox:true})}
  };
  // Cancel live startup before DOMContentLoaded; retain the real renderers and role predicates.
  document.removeEventListener('DOMContentLoaded',init4120);
  document.removeEventListener('DOMContentLoaded',init41121);
  removeHistoricalStartupWatchers41121();
  window.supabase={createClient:()=>client};db=client;currentUser=user;
  pushSupported=()=>false;
  getServiceWorkerRegistration=async()=>null;
  sendTeamGeneratedNotification=async()=>{};
  function changeView(role,playerId){
    if(!['player','teammate','captain','admin'].includes(role))return;
    const linked=tables.players.find(p=>String(p.id)===String(playerId))||tables.players[0];
    Object.assign(tables.profiles[0],{role:role==='player'?'user':role,player_id:linked?.id||null,first_name:linked?.first_name||'',last_name:linked?.last_name||'',full_name:linked?.full_name||''});
    // Teammate-generated games are local to that role, just as in the live app.
    state.currentGameIsLocalTeammate41117=false;
    localStorage.clear();hideAllModals();
    applyBootstrapPayload4120(clone(bootstrap()));
    updateAuthButtons();renderAll();showPage('main');
  }
  async function start(){
    try{
      document.body.classList.add('ut-sandbox-runtime');
      hideSignInBox();hideAllModals();
      changeView(seed.role||'admin',seed.playerId);
      await refreshGameNightStats4120();
      // Prevent recursively opening another sandbox from this app copy.
      if(window.parent!==window)document.getElementById('dataSandboxLauncher')?.remove();
      window.parent.postMessage({type:'ut-sandbox-ready'},'*');
    }catch(e){window.parent.postMessage({type:'ut-sandbox-error',message:e.message},'*');console.error(e)}
  }
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.data?.type!=='ut-sandbox-view')return;
    changeView(event.data.role,event.data.playerId);
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
