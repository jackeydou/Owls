import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToolWidgetComponentProps } from './types'

const SHELL_JS = `
(function(){
  var _rid, _wid = document.documentElement.getAttribute("data-wid") || "";
  var root = document.getElementById("widget-root");
  var _lastMarkup = "";
  function measure(){
    var body = document.body;
    if(!body) return 0;
    var rect = body.getBoundingClientRect();
    return Math.max(
      Math.ceil(rect.height),
      body.scrollHeight,
      body.offsetHeight
    );
  }
  function send(){
    var h = measure();
    if(h > 0) window.parent.postMessage({type:"widget-resize", id:_wid, height:h}, "*");
  }
  function activateScripts(container){
    var scripts = container.querySelectorAll("script");
    for(var i = 0; i < scripts.length; i++){
      var oldScript = scripts[i];
      var script = document.createElement("script");
      for(var j = 0; j < oldScript.attributes.length; j++){
        var attr = oldScript.attributes[j];
        script.setAttribute(attr.name, attr.value);
      }
      script.textContent = oldScript.textContent || "";
      oldScript.parentNode && oldScript.parentNode.replaceChild(script, oldScript);
    }
  }
  function splitAtScript(html){
    var idx = html.toLowerCase().indexOf("<script");
    if(idx === -1) return { markup: html, scripts: "" };
    return { markup: html.slice(0, idx), scripts: html.slice(idx) };
  }
  function applyHtml(html, executeScriptsAfterRender){
    if(!root) return;
    if(!executeScriptsAfterRender){
      root.innerHTML = html;
      _lastMarkup = html;
    } else {
      var parts = splitAtScript(html);
      if(parts.markup !== _lastMarkup){
        root.innerHTML = html;
        _lastMarkup = parts.markup;
        activateScripts(root);
      } else {
        var temp = document.createElement("div");
        temp.innerHTML = parts.scripts;
        activateScripts(temp);
        while(temp.firstChild) root.appendChild(temp.firstChild);
      }
    }
    cancelAnimationFrame(_rid);
    _rid = requestAnimationFrame(send);
  }
  if(typeof ResizeObserver !== "undefined"){
    new ResizeObserver(function(){ cancelAnimationFrame(_rid); _rid = requestAnimationFrame(send); })
      .observe(document.body);
  }
  new MutationObserver(function(){ cancelAnimationFrame(_rid); _rid = requestAnimationFrame(send); })
    .observe(document.body, {childList:true, subtree:true, attributes:true, characterData:true});
  window.addEventListener("message", function(event){
    var data = event.data;
    if(!data || data.type !== "widget-html-update" || data.id !== _wid) return;
    applyHtml(typeof data.html === "string" ? data.html : "", !!data.executeScripts);
  });
  window.addEventListener("load", send);
  setTimeout(send, 50);
  send();
})();
`

const CLOSE_TAG = '</scr' + 'ipt>'

function buildShellSrcdoc(widgetId: string): string {
  return `<!DOCTYPE html><html data-wid="${widgetId}"><head><meta charset="utf-8"></head><body style="margin:0"><div id="widget-root"></div><script>${SHELL_JS}${CLOSE_TAG}</body></html>`
}

function buildRenderableHtml(html: string, isStreaming: boolean): string {
  if (!isStreaming) return html

  const scriptIndex = html.toLowerCase().indexOf('<script')
  if (scriptIndex === -1) return html

  return html.slice(0, scriptIndex)
}

export function StreamingUIToolWidget({
  widget,
  isStreaming
}: ToolWidgetComponentProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const lastPostedRef = useRef<{ html: string; executeScripts: boolean } | null>(null)
  const [contentHeight, setContentHeight] = useState(200)
  const [shellReady, setShellReady] = useState(false)
  const html = typeof widget.args.html === 'string' ? widget.args.html : ''
  const htmlToRender = buildRenderableHtml(html, isStreaming)
  const deferringScripts = isStreaming && htmlToRender !== html
  const shouldExecuteScripts = !isStreaming

  const handleMessage = useCallback(
    (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (
        e.data?.type === 'widget-resize' &&
        e.data.id === widget.toolCallId &&
        typeof e.data.height === 'number'
      ) {
        const nextHeight = Math.max(48, Math.ceil(e.data.height))
        setContentHeight((current) => (Math.abs(current - nextHeight) > 2 ? nextHeight : current))
      }
    },
    [widget.toolCallId]
  )

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  useEffect(() => {
    if (!shellReady) return

    const nextPayload = {
      html: htmlToRender,
      executeScripts: shouldExecuteScripts
    }
    const prevPayload = lastPostedRef.current

    if (
      prevPayload &&
      prevPayload.html === nextPayload.html &&
      prevPayload.executeScripts === nextPayload.executeScripts
    ) {
      return
    }

    iframeRef.current?.contentWindow?.postMessage(
      {
        type: 'widget-html-update',
        id: widget.toolCallId,
        html: nextPayload.html,
        executeScripts: nextPayload.executeScripts
      },
      '*'
    )
    lastPostedRef.current = nextPayload
  }, [htmlToRender, shellReady, shouldExecuteScripts, widget.toolCallId])

  if (!htmlToRender && !html) {
    return (
      <div className="px-1 py-2 text-[12px] text-muted-foreground">
        {isStreaming ? 'Waiting for streamed HTML...' : 'No HTML content available.'}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg">
      {deferringScripts && (
        <div className="bg-card-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
          Scripts will run after streaming completes.
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={widget.title}
        sandbox="allow-scripts"
        srcDoc={buildShellSrcdoc(widget.toolCallId)}
        onLoad={() => setShellReady(true)}
        style={{ height: `${contentHeight}px` }}
        className="w-full border-0 bg-white"
      />
    </div>
  )
}
