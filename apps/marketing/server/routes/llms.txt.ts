export default defineEventHandler(() => {
  const body = `# MDR

> Persistent layered memory for your coding agent. A searchable journal, always-on state files, semantic search across every past session, a background daemon for reminders, and overnight self-maintenance. Fully local, fully offline, fully MIT.

Homepage: https://mdr.geoql.in
Install: { "plugin": ["@geoql/mdr@latest"] } in opencode.json
Hard fork of https://github.com/ascorbic/macrodata by Matt Kane.
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
});
