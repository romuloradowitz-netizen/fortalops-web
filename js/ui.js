export class DashboardUI {
  constructor(translator, pixKeyDisplay) {
    this.translator = translator;
    this.pixKeyDisplay = pixKeyDisplay;
  }

  formatPlanPrice(plan, billingCycle) {
    const lang = this.translator.lang;
    const base = lang === 'pt' ? Number(plan.price_brl_monthly) : Number(plan.price_usd_monthly);
    let mult = 1;
    if (billingCycle === 'annual') mult = 1 - (plan.discount_annual_pct / 100);
    if (billingCycle === 'biennial') mult = 1 - (plan.discount_biennial_pct / 100);
    const finalVal = (base * mult).toFixed(2);
    return lang === 'pt' ? `R$ ${finalVal.replace('.', ',')}` : `$ ${finalVal}`;
  }

  calculateRenewalDate(sub) {
    const start = new Date(sub.current_period_start || sub.created_at);
    const months = sub.billing_cycle === 'biennial' ? 24 : sub.billing_cycle === 'annual' ? 12 : 1;
    start.setMonth(start.getMonth() + months);
    return start.toLocaleDateString(this.translator.lang);
  }

  isWithin7Days(sub) {
    const created = new Date(sub.current_period_start || sub.created_at);
    const diffDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 7;
  }

  renderPlans(plans, billingCycle) {
    const grid = document.getElementById('dynamicPlansGrid');
    const lang = this.translator.lang;
    const activePlans = plans.filter((p) => p.active);

    const mpLogoSvg = `
      <svg width="22" height="16" viewBox="0 0 36 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="18" cy="12" rx="17" ry="11" fill="#FFFFFF" fill-opacity="0.22"/>
        <path d="M9.5 13.5C11.8 10.5 14.5 10.5 18 13.5C21.5 10.5 24.2 10.5 26.5 13.5" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M12.5 15.2C14.3 13.6 16.1 13.6 18 15.2C19.9 13.6 21.7 13.6 23.5 15.2" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
      </svg>`;

    const paypalLogoSvg = `
      <svg width="16" height="18" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.8 6.4C19.3 3.5 16.9 2 13.1 2H6.4C5.8 2 5.3 2.4 5.2 3L2.3 21.3C2.2 21.8 2.6 22.2 3.1 22.2H7.2L8.3 15.3L8.2 15.6C8.3 15 8.8 14.6 9.4 14.6H11.9C16.7 14.6 20.4 12.6 21.5 7.1C21.5 6.9 21.6 6.6 21.6 6.4H19.8Z" fill="#003087"/>
        <path d="M21.5 7.1C20.4 12.6 16.7 14.6 11.9 14.6H9.4C8.8 14.6 8.3 15 8.2 15.6L6.8 24.4C6.7 24.8 7.1 25.2 7.5 25.2H11.1C11.6 25.2 12.1 24.8 12.2 24.3L12.3 23.9L13.1 18.8L13.2 18.5C13.3 18 13.7 17.6 14.2 17.6H14.9C19.1 17.6 22.4 15.9 23.3 11.1C23.7 9.1 23.5 7.5 22.4 6.4C22.1 6.6 21.8 6.9 21.5 7.1Z" fill="#0079C1"/>
      </svg>`;

    grid.innerHTML = activePlans.map((plan) => {
      const title = plan.names[lang] || plan.names.en || plan.names.pt;
      const feats = plan.features[lang] || plan.features.en || plan.features.pt || [];
      return `
        <div class="plan-card ${plan.is_popular ? 'popular' : ''}">
          ${plan.is_popular ? `<div class="badge-pop">${this.translator.t('popular_badge')}</div>` : ''}
          <h3>${title}</h3>
          <div class="plan-price">${this.formatPlanPrice(plan, billingCycle)} <small>${this.translator.t('per_month')}</small></div>
          <ul class="plan-features">${feats.map((f) => `<li>${f}</li>`).join('')}</ul>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <button class="btn" style="background: #009EE3; color: #ffffff;" data-subscribe-plan="${plan.id}" data-provider="mp">
              ${mpLogoSvg}
              <span>${this.translator.t('btn_mp')}</span>
            </button>
            <button class="btn" style="background: #FFC439; color: #003087;" data-subscribe-plan="${plan.id}" data-provider="paypal">
              ${paypalLogoSvg}
              <span>${this.translator.t('btn_paypal')}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderUserSubscriptions(subs) {
    const lang = this.translator.lang;
    const container = document.getElementById('clientSubscriptionsList');

    if (!subs || subs.length === 0) {
      container.innerHTML = `<p><a href="#pricing" style="color:var(--primary);">${this.translator.t('hero_cta_1')} →</a></p>`;
      return;
    }

    container.innerHTML = subs.map((s) => {
      const pName = s.plans?.names?.[lang] || s.plans?.names?.en || s.plans?.names?.pt || 'FortalOps VPN';
      const isPending = s.status === 'pending_payment';
      const isActive = s.status === 'active';
      const canRefund = isActive && this.isWithin7Days(s);
      const renewalDate = this.calculateRenewalDate(s);

      let statusHtml = `<span class="status-pill st-pending">⏳ ${s.status}</span>`;
      if (isActive) {
        statusHtml = `<span class="status-pill st-active">✅ Active (Data Center Tier III • Fortaleza-CE)</span>`;
      } else if (s.status === 'canceled' || s.status === 'refund_requested') {
        statusHtml = `<span class="status-pill" style="background:rgba(239,68,68,0.15);color:var(--danger);">✕ ${this.translator.t('sub_canceled_lbl')} (${s.status})</span>`;
      }

      return `
        <div style="border: 1px solid var(--border); padding: 16px; border-radius: 10px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div>
            <strong>${pName}</strong> (${s.billing_cycle.toUpperCase()}) • ${s.plans?.max_devices || 3} ${this.translator.t('devices_lbl')}
            <div style="margin-top: 6px;">${statusHtml}</div>
            ${isActive ? `<p style="font-size: 0.84rem; color: var(--muted); margin-top: 6px;">${this.translator.t('sub_renews')} <strong style="color:var(--text);">${renewalDate}</strong></p>` : ''}
            ${isPending
              ? `<p style="font-size: 0.85rem; color: var(--muted); margin-top: 8px;">Pix (BRL): <strong style="color:var(--text);">${this.pixKeyDisplay}</strong> <button class="btn btn-ghost btn-sm" style="margin-left:8px;" data-copy-pix="${this.pixKeyDisplay}">Copy Pix</button></p>`
              : isActive ? `<p style="font-size: 0.85rem; color: var(--accent); margin-top: 4px;">WireGuard® Zero-Logs Tunnel Ready.</p>` : ''}
          </div>
          ${isActive ? `
            <div>
              <button class="btn btn-ghost btn-sm" style="border-color: var(--danger); color: var(--danger);" data-cancel-sub="${s.id}" data-refund-7d="${canRefund}">
                ${canRefund ? this.translator.t('btn_refund_7d') : this.translator.t('btn_cancel_sub')}
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  renderUserPayments(payments) {
    const container = document.getElementById('clientPaymentsList');
    if (!container) return;

    if (!payments || payments.length === 0) {
      container.innerHTML = `<p style="color: var(--muted); font-size: 0.9rem;">${this.translator.t('no_invoices')}</p>`;
      return;
    }

    container.innerHTML = `
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>${this.translator.t('inv_date')}</th>
              <th>${this.translator.t('inv_provider')}</th>
              <th>${this.translator.t('inv_amount')}</th>
              <th>${this.translator.t('inv_status')}</th>
            </tr>
          </thead>
          <tbody>
            ${payments.map((p) => `
              <tr>
                <td>${new Date(p.created_at).toLocaleDateString(this.translator.lang)}</td>
                <td style="text-transform: uppercase;">${p.provider}</td>
                <td><strong>${p.currency === 'USD' ? '$' : 'R$'} ${Number(p.amount).toFixed(2)}</strong></td>
                <td><span class="status-pill st-active">${p.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderAdminPlans(plans) {
    const tbody = document.getElementById('adminPlansTable');
    tbody.innerHTML = plans.map((p) => `
      <tr>
        <td><strong>${p.names.pt}</strong></td>
        <td>R$ ${Number(p.price_brl_monthly).toFixed(2)}</td>
        <td>$ ${Number(p.price_usd_monthly).toFixed(2)}</td>
        <td>${p.max_devices}</td>
        <td><span class="status-pill ${p.active ? 'st-active' : 'st-pending'}">${p.active ? 'Ativo' : 'Oculto'}</span></td>
        <td><button class="btn btn-ghost btn-sm" data-toggle-plan="${p.id}" data-plan-active="${p.active}">${p.active ? 'Desativar' : 'Ativar'}</button></td>
      </tr>
    `).join('');
  }

  renderAdminSubscriptions(subs) {
    const tbody = document.getElementById('adminSubsTable');
    tbody.innerHTML = (subs || []).map((s) => `
      <tr>
        <td>${s.profiles?.full_name || ''} <br><small style="color:var(--muted);">${s.profiles?.email || ''}</small></td>
        <td>${s.plans?.names?.pt || '-'}</td>
        <td>${s.billing_cycle}</td>
        <td><span class="status-pill ${s.status === 'active' ? 'st-active' : 'st-pending'}">${s.status}</span></td>
        <td>${s.status !== 'active' ? `<button class="btn btn-accent btn-sm" data-approve-sub="${s.id}">Aprovar Pagamento</button>` : '✓ Liberado'}</td>
      </tr>
    `).join('');
  }

  openAuthModal(mode) {
    document.getElementById('authFeedback').innerText = '';
    document.getElementById('nameGroup').style.display = mode === 'login' ? 'none' : 'block';
    document.getElementById('termsGroup').style.display = mode === 'login' ? 'none' : 'flex';
    document.getElementById('acceptContract').required = mode !== 'login';
    document.getElementById('modalTitle').innerText = mode === 'login'
      ? this.translator.t('modal_login')
      : this.translator.t('modal_signup');
    document.getElementById('authModal').classList.add('open');
  }

  closeAuthModal() { document.getElementById('authModal').classList.remove('open'); }
  openContractModal() { document.getElementById('contractModal').classList.add('open'); }
  closeContractModal() { document.getElementById('contractModal').classList.remove('open'); }
}
