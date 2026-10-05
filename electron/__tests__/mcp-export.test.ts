// electron/__tests__/mcp-export.test.ts
//
// Pruebas unitarias para «Copiar para otra herramienta» de servidores MCP (tarea 6.2, D12).
//
// Verifica la conversión a los tres formatos: Claude Code, VS Code y OpenCode;
// la conversión de referencias (${env:X} -> ${X}, ${env:X}, {env:X});
// el enmascaramiento de URLs para la vista previa;
// la detección y sanitización de secretos literales;
// y los avisos de deprecación e incompatibilidad.

import { describe, expect, it } from 'vitest';
import {
  buildMcpExport,
  convertReferencesForTarget,
  detectLiteralSecrets,
  maskUrlsForPreview,
  maskUrlString,
} from '../ai/config/mcp-export';
import type { McpServer } from '../ai/config/mcp-config';

describe('mcp-export', () => {
  describe('convertReferencesForTarget', () => {
    it('convierte ${env:VAR} al formato de cada herramienta', () => {
      const input = {
        key: '${env:GITHUB_PAT}',
        nested: { ref: '${env:OTHER_VAR}' },
        list: ['${env:LIST_VAR}', 'plain'],
      };

      // Claude Code: ${VAR}
      expect(convertReferencesForTarget(input, 'claude')).toEqual({
        key: '${GITHUB_PAT}',
        nested: { ref: '${OTHER_VAR}' },
        list: ['${LIST_VAR}', 'plain'],
      });

      // VS Code: ${env:VAR}
      expect(convertReferencesForTarget(input, 'vscode')).toEqual({
        key: '${env:GITHUB_PAT}',
        nested: { ref: '${env:OTHER_VAR}' },
        list: ['${env:LIST_VAR}', 'plain'],
      });

      // OpenCode: {env:VAR}
      expect(convertReferencesForTarget(input, 'opencode')).toEqual({
        key: '{env:GITHUB_PAT}',
        nested: { ref: '{env:OTHER_VAR}' },
        list: ['{env:LIST_VAR}', 'plain'],
      });
    });

    it('convierte también {env:VAR} existentes al formato de Claude y VS Code', () => {
      expect(convertReferencesForTarget('{env:MI_TOKEN}', 'claude')).toBe('${MI_TOKEN}');
      expect(convertReferencesForTarget('{env:MI_TOKEN}', 'vscode')).toBe('${env:MI_TOKEN}');
      expect(convertReferencesForTarget('{env:MI_TOKEN}', 'opencode')).toBe('{env:MI_TOKEN}');
    });
  });

  describe('enmascaramiento de URLs para vista previa', () => {
    it('enmascara contraseñas y parámetros de consulta en URLs', () => {
      expect(maskUrlString('postgresql://ale:pa55word@db.local/app')).toBe('postgresql://ale:***@db.local/app');
      expect(maskUrlString('https://mcp.remote.example.com/sse?token=abc-query-secret')).toBe(
        'https://mcp.remote.example.com/sse?token=***',
      );
      expect(maskUrlString('https://mcp.supabase.com/mcp?project_ref=EJEMPLO&key=secret')).toBe(
        'https://mcp.supabase.com/mcp?project_ref=***&key=***',
      );
      expect(maskUrlString('https://mcp.vercel.com')).toBe('https://mcp.vercel.com');
      expect(maskUrlString('npx')).toBe('npx');
    });

    it('enmascara URLs anidadas en objetos y listas para la vista previa', () => {
      const obj = {
        url: 'https://mcp.supabase.com/mcp?project_ref=EJEMPLO',
        args: ['-y', 'postgresql://user:secret@localhost:5432/db'],
      };
      const masked = maskUrlsForPreview(obj) as any;
      expect(masked.url).toBe('https://mcp.supabase.com/mcp?project_ref=***');
      expect(masked.args[1]).toBe('postgresql://user:***@localhost:5432/db');
    });
  });

  describe('los seis servidores de la forma medida de Ale', () => {
    const fallow: McpServer = {
      command: 'npx',
      args: ['-y', '--package', 'fallow', 'fallow-mcp'],
    };

    const github: McpServer = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${env:GITHUB_PAT}' },
    };

    const supabase: McpServer = {
      url: 'https://mcp.supabase.com/mcp?project_ref=EJEMPLO',
    };

    const netlifyMcp: McpServer = {
      url: 'https://netlify-mcp.netlify.app/mcp',
    };

    const netlifyLocalMcp: McpServer = {
      command: 'npx',
      args: ['-y', '@netlify/mcp'],
    };

    const vercel: McpServer = {
      url: 'https://mcp.vercel.com',
    };

    it('exporta fallow a Claude, VS Code y OpenCode', () => {
      const resClaude = buildMcpExport({ serverName: 'fallow', server: fallow, disabled: true, target: 'claude' });
      expect(JSON.parse(resClaude.exportPlan.clipboardText)).toEqual({
        mcpServers: {
          fallow: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '--package', 'fallow', 'fallow-mcp'],
          },
        },
      });

      const resVsCode = buildMcpExport({ serverName: 'fallow', server: fallow, disabled: true, target: 'vscode' });
      expect(JSON.parse(resVsCode.exportPlan.clipboardText)).toEqual({
        servers: {
          fallow: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '--package', 'fallow', 'fallow-mcp'],
          },
        },
      });

      const resOpenCode = buildMcpExport({ serverName: 'fallow', server: fallow, disabled: true, target: 'opencode' });
      expect(JSON.parse(resOpenCode.exportPlan.clipboardText)).toEqual({
        mcp: {
          fallow: {
            type: 'local',
            command: ['npx', '-y', '--package', 'fallow', 'fallow-mcp'],
            enabled: false,
          },
        },
      });
    });

    it('exporta github traduciendo la referencia ${env:GITHUB_PAT}', () => {
      // Claude Code -> ${GITHUB_PAT}
      const resClaude = buildMcpExport({ serverName: 'github', server: github, disabled: true, target: 'claude' });
      expect(JSON.parse(resClaude.exportPlan.clipboardText)).toEqual({
        mcpServers: {
          github: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PAT}' },
          },
        },
      });

      // VS Code -> ${env:GITHUB_PAT}
      const resVsCode = buildMcpExport({ serverName: 'github', server: github, disabled: true, target: 'vscode' });
      expect(JSON.parse(resVsCode.exportPlan.clipboardText)).toEqual({
        servers: {
          github: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${env:GITHUB_PAT}' },
          },
        },
      });

      // OpenCode -> {env:GITHUB_PAT}
      const resOpenCode = buildMcpExport({ serverName: 'github', server: github, disabled: true, target: 'opencode' });
      expect(JSON.parse(resOpenCode.exportPlan.clipboardText)).toEqual({
        mcp: {
          github: {
            type: 'local',
            command: ['npx', '-y', '@modelcontextprotocol/server-github'],
            environment: { GITHUB_PERSONAL_ACCESS_TOKEN: '{env:GITHUB_PAT}' },
            enabled: false,
          },
        },
      });
    });

    it('exporta remotos sin tipo: asume Streamable HTTP con aviso y oculta query params en preview', () => {
      const resClaude = buildMcpExport({ serverName: 'supabase', server: supabase, disabled: true, target: 'claude' });
      expect(resClaude.exportPlan.warnings).toContain('type_default_streamable_http');
      expect(JSON.parse(resClaude.exportPlan.clipboardText)).toEqual({
        mcpServers: {
          supabase: {
            type: 'http',
            url: 'https://mcp.supabase.com/mcp?project_ref=EJEMPLO',
          },
        },
      });
      // Vista previa con URL enmascarada
      expect(JSON.parse(resClaude.exportPlan.previewText)).toEqual({
        mcpServers: {
          supabase: {
            type: 'http',
            url: 'https://mcp.supabase.com/mcp?project_ref=***',
          },
        },
      });

      const resOpenCode = buildMcpExport({ serverName: 'supabase', server: supabase, disabled: true, target: 'opencode' });
      expect(JSON.parse(resOpenCode.exportPlan.clipboardText)).toEqual({
        mcp: {
          supabase: {
            type: 'remote',
            url: 'https://mcp.supabase.com/mcp?project_ref=EJEMPLO',
            enabled: false,
          },
        },
      });
    });

    it('exporta netlify-local-mcp y vercel correctamente', () => {
      const resLocal = buildMcpExport({ serverName: 'netlify-local-mcp', server: netlifyLocalMcp, target: 'claude' });
      expect(JSON.parse(resLocal.exportPlan.clipboardText).mcpServers['netlify-local-mcp']).toEqual({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@netlify/mcp'],
      });

      const resRemote = buildMcpExport({ serverName: 'vercel', server: vercel, target: 'vscode' });
      expect(JSON.parse(resRemote.exportPlan.clipboardText).servers.vercel).toEqual({
        type: 'http',
        url: 'https://mcp.vercel.com',
      });
    });
  });

  describe('avisos e incompatibilidades de transporte y campos', () => {
    it('advierte cuando el servidor declara type: "sse" porque está deprecado por la especificación', () => {
      const sseServer: McpServer = {
        type: 'sse',
        url: 'https://mcp.legacy.example.com/sse',
      };
      const res = buildMcpExport({ serverName: 'legacy', server: sseServer, target: 'claude' });
      expect(res.exportPlan.warnings).toContain('type_sse_deprecated');
      expect(JSON.parse(res.exportPlan.clipboardText).mcpServers.legacy.type).toBe('sse');
    });

    it('advierte y omite envFile al exportar hacia OpenCode (OpenCode no lo admite)', () => {
      const envFileServer: McpServer = {
        command: 'node',
        args: ['server.js'],
        envFile: '.env.mcp',
      };

      // VS Code y Claude Code lo conservan
      const resVs = buildMcpExport({ serverName: 'srv', server: envFileServer, target: 'vscode' });
      expect(resVs.exportPlan.warnings).not.toContain('opencode_no_envfile');
      expect(JSON.parse(resVs.exportPlan.clipboardText).servers.srv.envFile).toBe('.env.mcp');

      // OpenCode lo omite y genera aviso
      const resOpen = buildMcpExport({ serverName: 'srv', server: envFileServer, target: 'opencode' });
      expect(resOpen.exportPlan.warnings).toContain('opencode_no_envfile');
      expect(JSON.parse(resOpen.exportPlan.clipboardText).mcp.srv.envFile).toBeUndefined();
    });
  });

  describe('higiene de secretos literales (D5)', () => {
    const serverWithLiterals: McpServer = {
      command: 'npx',
      args: ['-y', 'postgres', 'postgresql://ale:super_secret_db_pass@db.internal:5432/app'],
      env: {
        DATABASE_TOKEN: 'token_escrito_a_mano_12345',
      },
      headers: {
        Authorization: 'Bearer literal_api_token_67890',
      },
    };

    it('un valor escrito a mano en env o headers no aparece en el plan, ni en la preview, ni en el portapapeles', () => {
      const res = buildMcpExport({
        serverName: 'dbserver',
        server: serverWithLiterals,
        target: 'claude',
      });

      const forbidden = [
        'token_escrito_a_mano_12345',
        'literal_api_token_67890',
        'super_secret_db_pass',
      ];

      // 1. En previewText
      for (const secret of forbidden) {
        expect(res.exportPlan.previewText).not.toContain(secret);
      }
      expect(res.exportPlan.previewText).toContain('postgresql://ale:***@db.internal:5432/app');

      // 2. En clipboardText
      expect(res.exportPlan.clipboardText).not.toContain('token_escrito_a_mano_12345');
      expect(res.exportPlan.clipboardText).not.toContain('literal_api_token_67890');
      // La contraseña de la URL va en el portapapeles completa
      expect(res.exportPlan.clipboardText).toContain('postgresql://ale:super_secret_db_pass@db.internal:5432/app');

      // 3. En la respuesta literalSecrets pública para el renderer (sin valores)
      expect(res.exportPlan.literalSecrets).toEqual([
        { key: 'DATABASE_TOKEN', location: 'env', proposedVar: 'DATABASE_TOKEN' },
        { key: 'Authorization', location: 'headers', proposedVar: 'DBSERVER_AUTHORIZATION' },
      ]);
      expect((res.exportPlan.literalSecrets[0] as any).value).toBeUndefined();

      // 4. En el texto copiado de Claude Code las variables son ${DATABASE_TOKEN} y ${DBSERVER_AUTHORIZATION}
      const claudeParsed = JSON.parse(res.exportPlan.clipboardText);
      expect(claudeParsed.mcpServers.dbserver.env.DATABASE_TOKEN).toBe('${DATABASE_TOKEN}');
      expect(claudeParsed.mcpServers.dbserver.headers.Authorization).toBe('${DBSERVER_AUTHORIZATION}');

      // 5. Los secretos crudos se conservan internamente sólo para el proceso principal
      expect(res.rawSecrets).toEqual([
        { key: 'DATABASE_TOKEN', location: 'env', proposedVar: 'DATABASE_TOKEN', value: 'token_escrito_a_mano_12345' },
        { key: 'Authorization', location: 'headers', proposedVar: 'DBSERVER_AUTHORIZATION', value: 'Bearer literal_api_token_67890' },
      ]);
    });

    it('en VS Code los secretos se sustituyen por ${env:VAR} y en OpenCode por {env:VAR}', () => {
      const resVs = buildMcpExport({ serverName: 'dbserver', server: serverWithLiterals, target: 'vscode' });
      const vsParsed = JSON.parse(resVs.exportPlan.clipboardText);
      expect(vsParsed.servers.dbserver.env.DATABASE_TOKEN).toBe('${env:DATABASE_TOKEN}');
      expect(vsParsed.servers.dbserver.headers.Authorization).toBe('${env:DBSERVER_AUTHORIZATION}');

      const resOpen = buildMcpExport({ serverName: 'dbserver', server: serverWithLiterals, target: 'opencode' });
      const openParsed = JSON.parse(resOpen.exportPlan.clipboardText);
      expect(openParsed.mcp.dbserver.environment.DATABASE_TOKEN).toBe('{env:DATABASE_TOKEN}');
      expect(openParsed.mcp.dbserver.headers.Authorization).toBe('{env:DBSERVER_AUTHORIZATION}');
    });
  });
});
