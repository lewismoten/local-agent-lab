import { useState } from 'react';
import { browserFileTools, type ToolScope } from './harnessTools.ts';
import { browserHistoryTools } from './harnessHistory.ts';
import { browserMemoryTools } from './harnessMemoryTools.ts';
import { imageTool } from './harnessMultimodal.ts';
import { requestToolsTool } from './harnessToolDiscovery.ts';
import { toolPermission, type ToolPermission } from './harnessToolPermissions.ts';
import type { ConversationMeta, HarnessProject, ToolPolicyProfile } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';

type ToolEntry = { name: string; description: string };
const entries = (definitions: { function: { name: string; description?: string } }[]): ToolEntry[] =>
  definitions.map(({ function: tool }) => ({ name: tool.name, description: tool.description || '' }));

function ToolGroup({ title, tools, note, project, conversation, scope, busy, onPolicyChange }: {
  title: string; tools: ToolEntry[]; note?: string; project: HarnessProject; conversation?: ConversationMeta | null; scope: ToolScope; busy: boolean;
  onPolicyChange: (name: string, permission: ToolPermission | 'inherit') => void;
}) {
  if (!tools.length) return null;
  return <section className="harness-tool-group"><h3>{title}</h3>{note && <p>{note}</p>}<dl>{tools.map(tool => {
    const projectMode = toolPermission({ ...scope, conversationProfileId: undefined, conversationPermissions: undefined }, tool.name);
    const conversationSetting = conversation?.toolPermissions?.[tool.name] ?? scope.toolProfiles?.find(profile => profile.id === conversation?.toolProfileId)?.permissions[tool.name];
    const inherited = conversation ? conversation.toolPermissions?.[tool.name] === undefined : !!project.toolProfileId && project.toolPermissions?.[tool.name] === undefined;
    const mode = toolPermission(scope, tool.name);
    const value = inherited ? 'inherit' : conversation ? conversation.toolPermissions?.[tool.name] || 'allow' : project.toolPermissions?.[tool.name] || 'allow';
    const approved = mode === 'once' && (conversationSetting === 'once' ? conversation?.approvedTools : project.approvedTools)?.includes(tool.name);
    return <div key={tool.name} className={mode === 'deny' ? 'blocked' : ''}>
      <div className="harness-tool-row"><dt>{tool.name}</dt><select aria-label={`${tool.name} permission`} value={conversation && projectMode === 'deny' ? 'inherit' : value} disabled={busy || !!conversation && projectMode === 'deny'} onChange={event => onPolicyChange(tool.name, event.target.value as ToolPermission | 'inherit')}>
        {conversation ? <option value="inherit">{conversation.toolProfileId ? 'Profile' : 'Project'}: {toolPermission({ ...scope, conversationPermissions: undefined }, tool.name)}</option> : project.toolProfileId && <option value="inherit">Profile: {mode}</option>}
        <option value="allow">Allowed</option><option value="deny">Blocked</option>
        <option value="ask">Ask every time</option>
        <option value="once">{approved ? conversationSetting === 'once' ? 'Approved for conversation' : 'Approved for project' : conversation ? 'Ask once per conversation' : 'Ask once per project'}</option>
        <option value="session">Ask once this session</option>
      </select></div>
      <dd>{tool.description}</dd>
      {approved && (!conversation || conversationSetting === 'once') && <button type="button" className="harness-tool-reset" disabled={busy} onClick={() => onPolicyChange(tool.name, value as ToolPermission | 'inherit')}>Reset approval</button>}
    </div>;
  })}</dl></section>;
}

/** Show callable definitions and project policy together, including blocked tools. */
export default function HarnessToolInventory({ folder, scope, project, store, conversation, imageAvailable, policyBusy, profiles, onPolicyChange, onProfileChange, onSaveProfile, onUpdateProfile, onDeleteProfile, conversationMode = false }: {
  folder: FileSystemDirectoryHandle | null;
  scope: ToolScope;
  project: HarnessProject;
  store: HarnessStore;
  conversation: ConversationMeta | null;
  imageAvailable: boolean;
  policyBusy: boolean;
  profiles: ToolPolicyProfile[];
  onPolicyChange: (name: string, permission: ToolPermission | 'inherit') => void;
  onProfileChange: (id: string) => void;
  onSaveProfile: (name: string) => Promise<boolean>;
  onUpdateProfile: (id: string) => void;
  onDeleteProfile: (id: string) => void;
  conversationMode?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const file = entries(browserFileTools(folder, scope)?.definitions || []);
  const git = file.filter(tool => tool.name.startsWith('git_'));
  const shell = file.filter(tool => tool.name === 'shell_readonly');
  const files = file.filter(tool => !tool.name.startsWith('git_') && tool.name !== 'shell_readonly');
  const history = conversation ? entries(browserHistoryTools(store, conversation)?.definitions || []) : [];
  const memory = conversation ? entries(browserMemoryTools(store, conversation, scope).definitions) : [];
  const readOnly = project.toolAccess === 'read-only';
  const images = imageAvailable && !readOnly ? entries([imageTool]) : [];
  const discovery = entries([requestToolsTool]);
  const all = [...discovery, ...files, ...shell, ...git, ...history, ...memory, ...images];
  const count = all.filter(tool => toolPermission(scope, tool.name) !== 'deny').length;
  const blocked = all.length - count;
  const matches = (tools: ToolEntry[]) => tools.filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const group = (title: string, tools: ToolEntry[], note?: string) => <ToolGroup title={title} tools={matches(tools)} note={note} project={project} conversation={conversationMode ? conversation : null} scope={scope} busy={policyBusy} onPolicyChange={onPolicyChange}/>;

  return <details className="harness-tool-inventory" open={conversationMode ? true : undefined}><summary>{conversationMode ? 'Permissions' : 'Model tools'} <span>{count} available{blocked ? ` · ${blocked} blocked` : ''}{readOnly ? ' · read-only' : ''}</span></summary><div className="harness-tool-inventory-body">
    <p>{conversationMode ? 'These choices apply only to this conversation. Project blocks still apply.' : `The model receives relevant tools for each request. Chat is limited to this project; agents use their configured access.${readOnly ? ' Model and agent tools cannot change this project; you can still edit files yourself.' : ''}`}</p>
    <div className="harness-tool-profile-row"><label>Permission profile<select value={profiles.some(item => item.id === (conversationMode ? conversation?.toolProfileId : project.toolProfileId)) ? conversationMode ? conversation?.toolProfileId : project.toolProfileId : ''} disabled={policyBusy} onChange={event => onProfileChange(event.target.value)}><option value="">{conversationMode ? 'Project rules' : 'Custom project rules'}</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><button type="button" className="harness-secondary" disabled={policyBusy} onClick={() => { setProfileName(`${conversationMode ? conversation?.title || project.name : project.name} tools`); setSavingProfile(true); }}>Save as profile</button>{!conversationMode && project.toolProfileId && profiles.some(item => item.id === project.toolProfileId) && <><button type="button" className="harness-secondary" disabled={policyBusy} onClick={() => onUpdateProfile(project.toolProfileId!)}>Update profile</button><button type="button" className="harness-danger" disabled={policyBusy} onClick={() => onDeleteProfile(project.toolProfileId!)}>Remove profile</button></>}</div>
    {savingProfile && <form className="harness-tool-profile-save" onSubmit={event => { event.preventDefault(); if (!profileName.trim()) return; void onSaveProfile(profileName.trim()).then(saved => { if (saved) setSavingProfile(false); }); }}><input autoFocus aria-label="New permission profile name" maxLength={80} value={profileName} onChange={event => setProfileName(event.target.value)}/><button className="harness-primary" disabled={policyBusy || !profileName.trim()}>Save</button><button type="button" className="harness-secondary" onClick={() => setSavingProfile(false)}>Cancel</button></form>}
    <input type="search" aria-label="Search model tools" className="harness-tool-search" placeholder="Search tools" value={query} onChange={event => setQuery(event.target.value)}/>
    {group('Tool discovery', discovery)}{group('Files', files)}{group('Project shell', shell, "Read-only pwd, ls, and cat inside this project's Files area. It cannot execute system commands.")}{group('Git', git, `Code folder: ${project.filesPath}`)}{!project.filesPath && <p>Set a code folder in Project settings to enable Git tools.</p>}{group('Conversation history', history)}{group('Memory', memory)}{group('Images', images)}
    {query && !all.some(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(query.trim().toLowerCase())) && <p>No matching tools.</p>}{!conversation && <p>Open a conversation to enable memory tools. History tools appear after a conversation is compacted.</p>}
  </div></details>;
}
