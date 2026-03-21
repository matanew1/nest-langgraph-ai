import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Delete,
  Post,
  Get,
  UseGuards,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { Sse, MessageEvent } from '@nestjs/common';
import { Observable, from, map } from 'rxjs';
import {
  AgentsService,
  AgentRunResult,
  ReviewPageData,
  StreamEvent,
} from './agents.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RunAgentDto, RunAgentResponseDto, StreamAgentDto } from './agents.dto';
import { ApiBody, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/decorators/api-standard-response.decorator';
import { ApiStandardDeleteResponse } from '@common/decorators/api-standard-delete-response.decorator';
import { ApiSessionIdParam } from '@common/decorators/api-session-id-param.decorator';

@ApiTags('Agents')
@Controller('agents')
@UseGuards(ThrottlerGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the AI agent with a natural-language prompt' })
  @ApiBody({ type: RunAgentDto })
  @ApiStandardResponse({
    type: RunAgentResponseDto,
    description: 'Agent answer',
  })
  async run(@Body() body: RunAgentDto): Promise<AgentRunResult> {
    return this.agentsService.run(body.prompt, body.sessionId);
  }

  @Post('stream')
  @HttpCode(HttpStatus.OK)
  @Sse()
  @ApiOperation({
    summary: 'Stream the AI agent execution in real-time via SSE',
    description:
      'Server-Sent Events endpoint for progressive agent updates (steps, tool calls, chunks). Supports Swagger UI streaming.',
  })
  @ApiBody({ type: StreamAgentDto })
  @ApiResponse({
    status: 200,
    description: 'SSE stream',
    content: {
      'text/event-stream': {
        schema: {
          type: 'object',
          properties: {
            data: { type: 'string' },
            event: {
              type: 'string',
              enum: [
                'status',
                'plan',
                'tool_call_started',
                'tool_call_finished',
                'llm_token',
                'llm_stream_reset',
                'review_required',
                'final',
                'error',
              ],
            },
            id: { type: 'string' },
          },
        },
      },
    },
  })
  stream(@Body() body: StreamAgentDto): Observable<MessageEvent> {
    return from(
      this.agentsService.streamRun(
        body.prompt,
        body.sessionId,
        body.streamPhases,
      ),
    ).pipe(
      map((event: StreamEvent) => {
        return {
          data: JSON.stringify(event),
          id: event.sessionId,
          type: event.type,
        } as unknown as MessageEvent;
      }),
    );
  }

  @Delete('session/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent session state from Redis' })
  @ApiSessionIdParam()
  @ApiStandardDeleteResponse({
    description: 'Session state deleted successfully',
  })
  async deleteSession(@Param('sessionId') sessionId: string): Promise<void> {
    return this.agentsService.deleteSession(sessionId);
  }

  @Get('review/:sessionId')
  @Header('Content-Type', 'text/html')
  @ApiOperation({
    summary: 'Human plan review page for a paused agent session',
  })
  @ApiSessionIdParam()
  async reviewPlan(@Param('sessionId') sessionId: string): Promise<string> {
    const data = await this.agentsService.getReviewPageData(sessionId);
    return this.buildReviewHtml(data);
  }

  @Get('session/:sessionId/review-data')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get pending plan review data as JSON' })
  @ApiSessionIdParam()
  async getReviewData(
    @Param('sessionId') sessionId: string,
  ): Promise<ReviewPageData | null> {
    try {
      return await this.agentsService.getReviewPageData(sessionId);
    } catch (error) {
      // Return null instead of 400 if no review is pending (avoids log noise on page load)
      if (error instanceof BadRequestException) {
        return null;
      }
      throw error;
    }
  }

  @Post('session/:sessionId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a pending plan and resume agent execution',
  })
  @ApiSessionIdParam()
  async approvePlan(
    @Param('sessionId') sessionId: string,
  ): Promise<AgentRunResult> {
    return this.agentsService.approvePlan(sessionId);
  }

  @Post('session/:sessionId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reject a pending plan and stop the agent run' })
  @ApiSessionIdParam()
  async rejectPlan(@Param('sessionId') sessionId: string): Promise<void> {
    return this.agentsService.rejectPlan(sessionId);
  }

  @Post('session/:sessionId/replan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject the plan and trigger a full re-plan' })
  @ApiSessionIdParam()
  async replanSession(
    @Param('sessionId') sessionId: string,
  ): Promise<AgentRunResult> {
    return this.agentsService.replanSession(sessionId);
  }

  // ─── HTML helpers ───────────────────────────────────────────────────────────

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private buildReviewHtml(data: ReviewPageData): string {
    const { sessionId, objective, plan } = data;
    const esc = (s: string) => this.escapeHtml(s);

    // Staggered slide-in: each row gets a delay based on its index
    const rows = plan
      .map(
        (step, i) =>
          `<tr class="step-row" style="animation-delay: ${i * 40}ms"><td>${step.step_id}</td><td>${esc(step.tool)}</td><td>${esc(step.description)}</td></tr>`,
      )
      .join('\n      ');

    const sessionDisplay =
      sessionId.length > 16 ? `${sessionId.slice(0, 16)}…` : sessionId;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Plan Review</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#1a1a1a;animation:cardEntrance 0.5s cubic-bezier(0.16, 1, 0.3, 1)}
    h1{font-size:1.35rem;margin-bottom:4px}
    .meta{font-size:.82rem;color:#666;margin-bottom:18px}
    .meta code{background:#f0f0f0;padding:1px 5px;border-radius:3px;font-size:.8rem}
    .objective{
      background:#f7f7f7;border-left:3px solid #f97316;padding:10px 14px;margin-bottom:24px;border-radius:0 4px 4px 0;font-size:.95rem;
      box-shadow: 0 0 0 0 rgba(249, 115, 22, 0);
      animation: pulseOrange 3s infinite;
    }
    table{width:100%;border-collapse:collapse;margin-bottom:28px;font-size:.9rem}
    th{text-align:left;padding:8px 12px;background:#f0f0f0;border-bottom:2px solid #ddd}
    td{padding:9px 12px;border-bottom:1px solid #eee;vertical-align:top}
    td:first-child{width:36px;color:#999;font-weight:600}
    td:nth-child(2){width:150px;font-family:monospace;font-size:.82rem;color:#333}
    .step-row{opacity:0;animation:slideIn 0.4s ease-out forwards}
    .actions{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
    button{padding:10px 22px;border:none;border-radius:6px;font-size:.92rem;cursor:pointer;font-weight:600;transition:opacity .15s;display:flex;align-items:center;justify-content:center;gap:8px}
    button:disabled{opacity:.45;cursor:not-allowed}
    .btn-approve{background:#16a34a;color:#fff}
    .btn-reject{background:#dc2626;color:#fff}
    .btn-replan{background:#2563eb;color:#fff}
    .spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
    #status{height:0;opacity:0;padding:0 16px;border-radius:6px;margin-top:4px;font-size:.9rem;overflow:hidden;transition:all 0.3s ease}
    #status.visible{height:auto;padding:14px 16px;opacity:1;margin-top:10px}
    #status.processing{background:#eff6ff;border:1px solid #93c5fd;color:#1e40af}
    #status.success{background:#f0fdf4;border:1px solid #86efac;color:#166534}
    #status.error{background:#fef2f2;border:1px solid #fca5a5;color:#991b1b}
    pre{background:#f8f8f8;padding:12px;border-radius:4px;white-space:pre-wrap;word-break:break-word;font-size:.82rem;margin:10px 0 0;max-height:280px;overflow-y:auto;border:1px solid #e5e5e5}
    
    @keyframes cardEntrance { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:scale(1)} }
    @keyframes slideIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    @keyframes pulseOrange { 0%{box-shadow:0 0 0 0 rgba(249,115,22,0.4)} 70%{box-shadow:0 0 0 6px rgba(249,115,22,0)} 100%{box-shadow:0 0 0 0 rgba(249,115,22,0)} }
    @keyframes spin { to{transform:rotate(360deg)} }
    @keyframes flashGreen { 0%{background-color:#dcfce7} 100%{background-color:#fff} }
    .flash-success { animation: flashGreen 0.6s ease-out; }

    @media (max-width: 640px) {
      .actions { flex-direction: column; }
      .actions button { width: 100%; padding: 14px; }
    }
  </style>
</head>
<body>
  <div class="card-wrap">
    <h1>Plan Review</h1>
    <div class="meta">Session: <code>${esc(sessionDisplay)}</code></div>
    <div class="objective"><strong>Objective:</strong> ${esc(objective)}</div>
    <table>
      <thead><tr><th>#</th><th>Tool</th><th>Description</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <div class="actions">
      <button class="btn-approve" onclick="act('approve')">&#10003; Approve</button>
      <button class="btn-reject"  onclick="act('reject')">&#10007; Reject</button>
      <button class="btn-replan"  onclick="act('replan')">&#8634; Replan</button>
    </div>
    <div id="status"></div>
  </div>
  <script>
    const sessionId = '${esc(sessionId)}';
    const btns = document.querySelectorAll('button');
    const status = document.getElementById('status');

    function setStatus(cls, html) {
      status.className = 'visible ' + cls;
      status.innerHTML = html;
    }

    function escHtml(s) {
      return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    async function act(action) {
      const clickedBtn = document.querySelector('.btn-' + action);
      btns.forEach(b => {
        b.disabled = true;
        if (b === clickedBtn) b.innerHTML = '<div class="spinner"></div> Processing...';
      });

      setStatus('processing', 'Processing\u2026');
      try {
        const res = await fetch('/api/agents/session/' + sessionId + '/' + action, { method: 'POST' });
        if (action === 'reject') {
          if (res.ok || res.status === 204) { setStatus('success', 'Plan rejected.'); return; }
        }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus('error', 'Error: ' + escHtml(body.message || res.statusText));
          btns.forEach(b => b.disabled = false);
          clickedBtn.innerHTML = action === 'approve' ? '&#10003; Approve' : action === 'replan' ? '&#8634; Replan' : '&#10007; Reject';
          return;
        }

        if (action === 'approve') {
          document.body.classList.add('flash-success');
          setTimeout(() => document.body.style.overflow = 'hidden', 100);
        }

        if (body.result) {
           const label = action === 'approve' ? 'Approved \u2014 final answer:' : 'Replanning complete \u2014 final answer:';
           setStatus('success', label + '<pre>' + escHtml(body.result) + '</pre>');
        } else {
           // If no result but success, likely a replan loop. Reload to show new plan.
           location.reload();
        }
      } catch {
        setStatus('error', 'Network error \u2014 please try again.');
        btns.forEach(b => b.disabled = false);
        if (clickedBtn) clickedBtn.innerHTML = 'Retry';
      }
    }
  </script>
</body>
</html>`;
  }
}
