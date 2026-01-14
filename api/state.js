
const { verify, parseCookies, json, readJson } = require('./_lib/auth');
const { ghDashDir, ghGetContent, ghPutFile, ghDeleteFile, readJsonFile } = require('./_lib/github');

const INDEX_FILE = '_index.json';

function getSession(req){
  const secret = process.env.AUTH_SECRET || 'dev-secret-change-me';
  const cookies = parseCookies(req);
  return verify(cookies.tw_session, secret);
}

function canWrite(role){ return role === 'admin' || role === 'creator'; }

module.exports = async (req,res)=>{
  try{
    const session = getSession(req);
    if(!session) return json(res,401,{error:'Not authenticated'});

    const url = new URL(req.url, 'http://localhost');
    const dash = url.searchParams.get('dash');
    const list = url.searchParams.get('list');

    const dir = ghDashDir();
    const indexPath = `${dir}/${INDEX_FILE}`;

    if(req.method==='GET' && list){
      const idx = await readJsonFile(indexPath);
      if(idx && Array.isArray(idx.dashboards)) return json(res,200,{dashboards: idx.dashboards});
      const listing = await ghGetContent(dir);
      const dashboards = Array.isArray(listing) ? listing
        .filter(x=>x.type==='file' && x.name.endsWith('.json') && x.name!==INDEX_FILE)
        .map(x=>({ id:x.name.replace(/\.json$/,''), name:x.name.replace(/\.json$/,''), createdAt:null, updatedAt:null })) : [];
      return json(res,200,{dashboards});
    }

    if(req.method==='GET' && dash){
      const data = await readJsonFile(`${dir}/${dash}.json`);
      if(!data) return json(res,404,{error:'Dashboard not found'});
      return json(res,200,{id:dash, state:data});
    }

    if(req.method==='POST' && dash){
      if(!canWrite(session.role)) return json(res,403,{error:'Forbidden'});
      let body={};
      try{ body = await readJson(req);}catch(e){ return json(res,400,{error:e.message}); }
      const state = body && body.state ? body.state : null;
      if(!state) return json(res,400,{error:'Missing body.state'});

      const now = new Date().toISOString();
      const name = (state.__meta && state.__meta.name) ? state.__meta.name : dash;
      state.__meta = { ...(state.__meta||{}), id:dash, name, updatedAt:now, savedBy: session.userId || 'unknown' };

      await ghPutFile(`${dir}/${dash}.json`, JSON.stringify(state, null, 2), `Save dashboard ${dash}`);

      const idx = (await readJsonFile(indexPath)) || { dashboards: [] };
      const arr = Array.isArray(idx.dashboards) ? idx.dashboards : [];
      const existing = arr.find(d=>d.id===dash);
      if(existing){ existing.name=name; existing.updatedAt=now; }
      else { arr.push({ id:dash, name, createdAt:now, updatedAt:now }); }
      idx.dashboards = arr;
      await ghPutFile(indexPath, JSON.stringify(idx, null, 2), 'Update dashboard index');

      return json(res,200,{ok:true, id:dash});
    }

    if(req.method==='DELETE' && dash){
      if(!canWrite(session.role)) return json(res,403,{error:'Forbidden'});
      await ghDeleteFile(`${dir}/${dash}.json`, `Delete dashboard ${dash}`);
      const idx = (await readJsonFile(indexPath)) || { dashboards: [] };
      idx.dashboards = (Array.isArray(idx.dashboards)?idx.dashboards:[]).filter(d=>d.id!==dash);
      await ghPutFile(indexPath, JSON.stringify(idx, null, 2), 'Update dashboard index');
      return json(res,200,{ok:true});
    }

    return json(res,400,{error:'Unsupported operation'});

  }catch(e){
    console.error(e);
    return json(res,500,{error:e.message||String(e)});
  }
};
