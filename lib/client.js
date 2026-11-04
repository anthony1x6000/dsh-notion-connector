window.__ModuleLoader__.load({
	id: "dsh-notion-connector",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  "use strict";
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/client/index.ts
  var index_exports = {};
  __export(index_exports, {
    apply: () => apply,
    inject: () => inject
  });
  module.exports = __toCommonJS(index_exports);
  var import_react2 = require("react");

  // src/client/NotionSettings.tsx
  var import_react = require("react");
  var import_jsx_runtime = require("react/jsx-runtime");
  var API = "/api/dsh-notion";
  var styles = {
    page: { display: "flex", flexDirection: "column", gap: 12, fontSize: 13, lineHeight: 1.5, padding: "4px 2px" },
    title: { margin: 0, fontSize: 15 },
    status: { padding: "8px 10px", borderRadius: 6, background: "rgba(127,127,127,.12)" },
    row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
    input: { flex: 1, minWidth: 220, padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(127,127,127,.35)", background: "rgba(127,127,127,.1)", color: "inherit", font: "inherit" },
    button: { padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" },
    buttonPrimary: { padding: "5px 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", font: "inherit", cursor: "pointer" },
    buttonDisabled: { opacity: 0.5, cursor: "default" },
    ok: { color: "#22c55e" },
    err: { color: "#ef4444" },
    hint: { opacity: 0.75, fontSize: 12 },
    hintP: { margin: "4px 0" }
  };
  async function api(path, body) {
    const response = await fetch(API + path, {
      method: body === void 0 ? "GET" : "POST",
      headers: body === void 0 ? void 0 : { "Content-Type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    if (!response.ok) {
      let reason = "";
      try {
        const body2 = await response.json();
        if (typeof body2.error === "string") reason = body2.error;
      } catch {
      }
      throw new Error(reason === "" ? `HTTP ${response.status}` : `${reason} (HTTP ${response.status})`);
    }
    return await response.json();
  }
  function NotionSettings() {
    const [status, setStatus] = (0, import_react.useState)(null);
    const [token, setToken] = (0, import_react.useState)("");
    const [busy, setBusy] = (0, import_react.useState)(false);
    const [message, setMessage] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
      api("/status").then(setStatus).catch((error) => {
        setMessage({ kind: "err", text: `Could not read status: ${error instanceof Error ? error.message : String(error)}` });
      });
    }, []);
    const save = (0, import_react.useCallback)(() => {
      const value = token.trim();
      if (value === "") {
        setMessage({ kind: "err", text: "Paste an Integration Token first" });
        return;
      }
      setBusy(true);
      setMessage(null);
      api("/token", { token: value }).then((result) => {
        if (result.ok === true) {
          setToken("");
          setStatus({ configured: true, workspaceName: result.workspaceName ?? "", workspaceIcon: result.workspaceIcon ?? "" });
          setMessage({ kind: "ok", text: `Connected: ${result.workspaceName || "Notion workspace"}` });
        } else {
          setMessage({ kind: "err", text: result.error ?? "Save failed" });
        }
      }).catch((error) => {
        setMessage({ kind: "err", text: `Save failed: ${error instanceof Error ? error.message : String(error)}` });
      }).finally(() => setBusy(false));
    }, [token]);
    const clear = (0, import_react.useCallback)(() => {
      setBusy(true);
      api("/clear", {}).then(() => {
        setStatus({ configured: false, workspaceName: "", workspaceIcon: "" });
        setMessage({ kind: "ok", text: "Configuration cleared" });
      }).catch((error) => {
        setMessage({ kind: "err", text: `Clear failed: ${error instanceof Error ? error.message : String(error)}` });
      }).finally(() => setBusy(false));
    }, []);
    const connected = status !== null && status.configured;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.page, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: styles.title, children: "Notion connection" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.status, children: connected ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        "Connected: ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: status.workspaceName || "(unnamed workspace)" })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.err, children: "Not configured" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          style: styles.input,
          type: "password",
          placeholder: "Paste a Notion Integration Token (ntn_... or secret_...)",
          value: token,
          spellCheck: false,
          onChange: (event) => setToken(event.target.value)
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: busy ? { ...styles.buttonPrimary, ...styles.buttonDisabled } : styles.buttonPrimary, disabled: busy, onClick: save, children: "Test and save" }),
        connected ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: busy ? { ...styles.button, ...styles.buttonDisabled } : styles.button, disabled: busy, onClick: clear, children: "Clear configuration" }) : null
      ] }),
      message !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: message.kind === "ok" ? styles.ok : styles.err, children: message.text }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.hint, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hintP, children: "1. Open the integrations page and create an internal integration, then copy its Internal Integration Secret." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hintP, children: "2. In Notion, share the pages or databases the agent needs with that integration." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hintP, children: "3. Paste the secret above and save. Saving validates it against Notion and reads the workspace name." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hintP, children: "Tools available once configured: notion_search, notion_read_page, notion_query_database, notion_create_page, notion_update_page, notion_append_blocks." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: styles.hintP, children: [
          "Create an integration: ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: "https://www.notion.so/my-integrations", target: "_blank", rel: "noreferrer", children: "https://www.notion.so/my-integrations" })
        ] })
      ] })
    ] });
  }

  // src/client/index.ts
  var inject = ["slots"];
  function apply(ctx) {
    ctx.slots.inject("settings.section", () => ctx.slots.register(
      { name: "settings.section", id: "notion", order: 30, label: "Notion" },
      () => (0, import_react2.createElement)(NotionSettings)
    ));
  }

		return module.exports;
	}
});
