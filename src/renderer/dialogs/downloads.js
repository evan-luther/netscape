/* "Saving Location" — per-download progress rows, live-updated from the
 * 'download:update' channel: {id, filename, url, received, total, state}. */
(function () {
  'use strict';
  var $ = dlg.$, el = dlg.el;
  dlg.initWindow();
  dlg.keys();

  var itemsEl = $('#items');
  var rows = {}; // id -> {fill, status, time, cancel, started, lastReceived, lastAt, rate}

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return 'Unknown';
    if (sec < 60) return Math.ceil(sec) + ' sec';
    return Math.floor(sec / 60) + ' min ' + Math.ceil(sec % 60) + ' sec';
  }

  function addRow(d) {
    var box = el('div', 'dl-item w95-panel-raised');
    box.style.padding = '6px';

    box.appendChild(el('div', null, 'Location: ' + (d.url || '')));
    box.appendChild(el('div', null, 'Saving to: ' + (d.filename || d.path || '')));

    var prog = el('div', 'w95-progress');
    prog.style.setProperty('--w95-progress-value', '0');
    box.appendChild(prog);

    var status = el('div', null, 'Status: ');
    var time = el('div', null, 'Time Left: Unknown');
    box.appendChild(status);
    box.appendChild(time);

    var cancel = el('button', 'w95-btn', 'Cancel');
    cancel.style.marginTop = '4px';
    cancel.addEventListener('click', function () {
      nsd.command('download.cancel', d.id);
      cancel.disabled = true;
    });
    box.appendChild(cancel);

    itemsEl.appendChild(box);
    rows[d.id] = {
      prog: prog, status: status, time: time, cancel: cancel,
      started: Date.now(), rate: 0
    };
    update(d);
  }

  function update(d) {
    var r = rows[d.id];
    if (!r) { addRow(d); return; }
    var pct = d.total > 0 ? Math.min(100, Math.round(d.received * 100 / d.total)) : 0;
    r.prog.style.setProperty('--w95-progress-value', String(pct));

    if (d.state === 'completed' || d.state === 'done') {
      r.status.textContent = 'Status: ' + dlg.fmtBytes(d.received) + ' — Done';
      r.time.textContent = 'Time Left: 0 sec';
      r.cancel.disabled = true;
      return;
    }
    if (d.state === 'cancelled' || d.state === 'canceled') {
      r.status.textContent = 'Status: Cancelled';
      r.cancel.disabled = true;
      return;
    }
    if (d.state === 'interrupted' || d.state === 'failed') {
      r.status.textContent = 'Status: Interrupted';
      r.cancel.disabled = true;
      return;
    }

    r.status.textContent = 'Status: ' + dlg.fmtBytes(d.received) + ' of ' +
      (d.total > 0 ? dlg.fmtBytes(d.total) : 'Unknown') +
      (d.total > 0 ? ', ' + pct + '% complete' : '');

    // rate estimate from deltas
    var now = Date.now();
    if (r.lastAt && d.received > r.lastReceived) {
      var inst = (d.received - r.lastReceived) / ((now - r.lastAt) / 1000);
      r.rate = r.rate ? r.rate * 0.7 + inst * 0.3 : inst;
    }
    r.lastReceived = d.received;
    r.lastAt = now;
    r.time.textContent = 'Time Left: ' +
      (d.total > 0 && r.rate > 0 ? fmtTime((d.total - d.received) / r.rate) : 'Unknown');
  }

  nsd.on('download:update', update);

  nsd.params().then(function (p) {
    var list = (p && (p.downloads || p.items)) || (p && p.id ? [p] : []);
    list.forEach(function (d) { if (!rows[d.id]) addRow(d); });
    if (!list.length && !itemsEl.children.length) {
      itemsEl.appendChild(el('div', null, 'No downloads in progress.'));
    }
  });

  $('#close').addEventListener('click', function () { nsd.close(); });
})();
