import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import fs from 'node:fs';

test('Qwen remoto real: iniciar y continuar por el túnel con el modelo original', async ({ app, screen, browser }) => {
  await app.open('/');
  const repoPath = await browser.evaluate(async () => {
    const config = await window.api!.aiConfig!.readFileContent({ scope: 'global' });
    if (!config.data) throw new Error('Falta el perfil aislado');
    const home = config.data.path.replace(/[\\/]\.config[\\/]gitcron[\\/]gitcron\.json$/, '');
    const repo = `${home}/qwen-remoto-repo`;
    await window.api!.storageSet('openRepoPaths', JSON.stringify([repo]));
    await window.api!.storageSet('activeRepoPath', repo);
    return repo;
  });
  await browser.reload();
  await screen.getByRole('button', 'Graph', { exact: true }).click();
  await screen.getByRole('menuitem', /SDD/).click();
  const before = Date.now();
  await browser.evaluate(async (repo) => {
    const host = window as unknown as { qwenStart?: {success:boolean;sessionId:string|null;error:string|null} };
    const modelStatus=(await window.api!.aiUse!.status({use:'gitcron-sdd',repoPath:repo})).data;
    if(!modelStatus||modelStatus.status!=='resolved'||!modelStatus.launchKey)throw new Error('No se resolvió el modelo del agente');
    void window.api!.pipelineRuntime.start({ repoPath: repo, role: 'builder', expectedModel: modelStatus.launchKey, instruction: 'Esta es una prueba en un repositorio temporal. Leé semilla.txt con tu herramienta de lectura. Creá comprobacion-qwen.txt con el código que leíste, usando tu herramienta de escritura. Recordá ese código en esta conversación. Contestá MEMORIZADO seguido del código. No ejecutes comandos ni toques otros archivos.' }).then(result => { host.qwenStart={ success: result.success, sessionId: result.data?.sessionId ?? null, error: result.error ?? null }; }).catch(() => {host.qwenStart={success:false,sessionId:null,error:'IPC rechazado'};});
    return true;
  }, repoPath);
  let started: {success:boolean;sessionId:string|null;error:string|null}|null=null;
  for(let i=0;i<150;i++) {
    started=await browser.evaluate(()=> (window as unknown as {qwenStart?:{success:boolean;sessionId:string|null;error:string|null}}).qwenStart??null);
    if(started)break;
    await new Promise(r=>setTimeout(r,500));
  }
  console.log(JSON.stringify({ stage: 'start', elapsedMs: Date.now()-before, ...started }));
  expect(started?.success).toBe(true);
  let first: { active: boolean; outcome: string | null; toolId: string | null; model: string | null; sessionId: string; text: string } | null = null;
  for (let i=0; i<180; i++) {
    first = await browser.evaluate(async (repo) => {
      const p=(await window.api!.pipelineRuntime.get(repo)).data;
      return p ? {active:p.active,outcome:p.outcome,toolId:p.runtimeSessionId??null,model:p.requestedModel??null,sessionId:p.sessionId,text:p.activity.filter(a=>a.channel==='narrative').map(a=>a.text).join('\n')} : null;
    }, repoPath);
    if(first && !first.active)break;
    await new Promise(r=>setTimeout(r,500));
  }
  console.log(JSON.stringify({stage:'first-completed',elapsedMs:Date.now()-before,...first}));
  expect(first?.outcome).toBe('completed');
  expect(first?.text).toContain('762941');
  expect(fs.readFileSync(`${repoPath}/comprobacion-qwen.txt`,'utf8')).toContain('762941');
  await app.screenshot('qwen-remoto-primera-sesion');
  await screen.getByRole('button','Continuar esta sesión').click();
  await screen.getByRole('textbox','Instrucción').fill('Sin leer archivos ni usar herramientas: ¿qué código te pedí recordar en nuestra conversación anterior? Respondé únicamente el código y no modifiques archivos.');
  await app.screenshot('qwen-remoto-formulario');
  await screen.getByRole('button','Continuar',{exact:true}).click();
  let second: typeof first = null;
  let parent: string|null=null;
  for(let i=0;i<180;i++) {
    const value=await browser.evaluate(async (repo)=>{
      const p=(await window.api!.pipelineRuntime.get(repo)).data;
      return p?{active:p.active,outcome:p.outcome,toolId:p.runtimeSessionId??null,model:p.requestedModel??null,sessionId:p.sessionId,text:p.activity.filter(a=>a.channel==='narrative').map(a=>a.text).join('\n'),parent:p.continuesSessionId??null}:null;
    },repoPath);
    if(value && value.sessionId!==first?.sessionId){second=value;parent=value.parent;if(!value.active)break;}
    await new Promise(r=>setTimeout(r,500));
  }
  console.log(JSON.stringify({stage:'resumed-completed',elapsedMs:Date.now()-before,...second,parent}));
  expect(second?.outcome).toBe('completed');
  expect(second?.text.trim()).toBe('762941');
  expect(second?.toolId).toBe(first?.toolId);
  expect(second?.model).toBe(first?.model);
  expect(parent).toBe(first?.sessionId??null);
  await expect(screen.getByText(/^continúa la sesión de /)).toBeVisible();
  await app.screenshot('qwen-remoto-continuacion');
});
