//************************************************************************************************
// StairPack - 階段状に録音されたテイクを、重ならない範囲で最小本数のトラックに詰める
//
// 使い方: まとめたいトラック（例: main 1〜main 21）をトラックリストで選択し、
//         トラックを右クリック →「階段テイクをまとめる」（またはトラックメニュー）
//
// ・トラックごとミュートしているトラックは触らない（その場に残す）
// ・テイク（レイヤー）を複数持つトラックも触らない
// ・音は一切切らない。重なる所だけ2本目・3本目に逃がす
// ・中身が空になったトラックは削除する
// ・実行ログを ドキュメント\Studio One\stairpack_log.txt に書き出す
//************************************************************************************************

var STAIRPACK_VERSION = "0.1.0";
var STAIRPACK_EPS = 0.0005; // 秒。これ以下の重なりは「重なっていない」とみなす

//////////////////////////////////////////////////////////////////////////////////////////////////
// ログ
//////////////////////////////////////////////////////////////////////////////////////////////////

function StairPackLog ()
{
	this.lines = [];
	this.add = function (text)
	{
		this.lines.push (String (text));
		try { Host.Console.writeLine ("[StairPack] " + text); } catch(e) {}
	};
	this.flush = function ()
	{
		var targets = ["local://$USERCONTENT/stairpack_log.txt"];
		for(var t = 0; t < targets.length; t++)
		{
			try
			{
				var file = Host.IO.createTextFile (Host.Url (targets[t]));
				if(file)
				{
					for(var i = 0; i < this.lines.length; i++)
						file.writeLine (this.lines[i]);
					file.close ();
					return targets[t];
				}
			}
			catch(e) {}
		}
		return null;
	};
}

function spTypeOf (obj, name)
{
	try { return typeof obj[name]; } catch(e) { return "error:" + e; }
}

function spSafe (fn, fallback)
{
	try { var v = fn (); return v === undefined ? fallback : v; } catch(e) { return fallback; }
}

//////////////////////////////////////////////////////////////////////////////////////////////////
// 純粋なロジック（Studio Oneに依存しない。Nodeでテストできる）
//
// tracks: [{ key, order, name, muted, layered, isAudio, isFolder, events: [{ s, e, name }] }]
// 戻り値: { ok, message, lanes: [trackInfo], moves: [{ ev, from, to, lane }], removable: [trackInfo],
//           skipped: [{ track, reason }] }
//////////////////////////////////////////////////////////////////////////////////////////////////

function stairPackPlan (tracks)
{
	var result = { ok: false, message: "", lanes: [], moves: [], removable: [], skipped: [], laneOf: [] };

	var active = [];
	for(var i = 0; i < tracks.length; i++)
	{
		var t = tracks[i];
		if(t.isFolder)        { result.skipped.push ({ track: t, reason: "folder" }); continue; }
		if(!t.isAudio)        { result.skipped.push ({ track: t, reason: "not audio" }); continue; }
		if(t.muted)           { result.skipped.push ({ track: t, reason: "muted" }); continue; }
		if(t.layered)         { result.skipped.push ({ track: t, reason: "has layers" }); continue; }
		active.push (t);
	}
	active.sort (function (a, b) { return a.order - b.order; });

	if(active.length < 2)
	{
		result.message = "まとめ対象のトラックが2本未満です（ミュート中・レイヤー付きのトラックは対象外）。";
		return result;
	}

	// 全イベントを開始位置順に並べる
	var events = [];
	for(var a = 0; a < active.length; a++)
	{
		var tr = active[a];
		for(var k = 0; k < tr.events.length; k++)
		{
			var ev = tr.events[k];
			events.push ({ ev: ev, src: tr, srcPos: a, s: ev.s, e: ev.e });
		}
	}
	events.sort (function (x, y)
	{
		if(x.s != y.s) return x.s - y.s;
		if(x.srcPos != y.srcPos) return x.srcPos - y.srcPos;
		return x.e - y.e;
	});

	// 区間スケジューリング（first-fit）。同じ元トラックの続きはなるべく同じレーンへ
	var laneEnd = [];
	var preferredLane = {};
	for(var n = 0; n < events.length; n++)
	{
		var item = events[n];
		var lane = -1;
		var pref = preferredLane[item.src.key];
		if(pref !== undefined && laneEnd[pref] <= item.s + STAIRPACK_EPS)
			lane = pref;
		if(lane < 0)
			for(var j = 0; j < laneEnd.length; j++)
				if(laneEnd[j] <= item.s + STAIRPACK_EPS) { lane = j; break; }
		if(lane < 0)
		{
			lane = laneEnd.length;
			laneEnd.push (item.e);
		}
		else
			laneEnd[lane] = Math.max (laneEnd[lane], item.e);

		item.lane = lane;
		if(preferredLane[item.src.key] === undefined)
			preferredLane[item.src.key] = lane;
	}

	if(laneEnd.length > active.length)
	{
		result.message = "同じトラック内でイベント同士が重なっているため、元の本数以下に詰められません。";
		return result;
	}

	result.lanes = active.slice (0, laneEnd.length);
	for(var m = 0; m < events.length; m++)
	{
		var it2 = events[m];
		var dest = result.lanes[it2.lane];
		result.laneOf.push ({ ev: it2.ev, lane: it2.lane, src: it2.src });
		if(dest !== it2.src)
			result.moves.push ({ ev: it2.ev, from: it2.src, to: dest, lane: it2.lane });
	}
	for(var r = laneEnd.length; r < active.length; r++)
		result.removable.push (active[r]);

	result.ok = true;
	return result;
}

//////////////////////////////////////////////////////////////////////////////////////////////////
// Studio One とのやりとり
//////////////////////////////////////////////////////////////////////////////////////////////////

function spCollectEvents (track)
{
	var list = [];
	var iter = track.createIterator ();
	if(!iter)
		return list;
	var guard = 0;
	var ev;
	while((ev = iter.next ()) && guard++ < 100000)
	{
		var s = spSafe (function () { return ev.startTime.seconds; }, null);
		var e = spSafe (function () { return ev.endTime.seconds; }, null);
		if(s === null || e === null)
			continue;
		list.push ({ obj: ev, s: s, e: e, name: spSafe (function () { return ev.name; }, "") });
	}
	return list;
}

function spFindEventOnTrack (track, ref)
{
	var events = spCollectEvents (track);
	for(var i = 0; i < events.length; i++)
	{
		var x = events[i];
		if(Math.abs (x.s - ref.s) < 0.0005 && Math.abs (x.e - ref.e) < 0.0005 && x.name == ref.name)
			return x;
	}
	return null;
}

function spMoveEvent (context, functions, move, log, state)
{
	// 方法A: functions.transferEvent(イベント, 移動先トラック)
	if(typeof functions.transferEvent == "function")
	{
		try
		{
			state.attempted = true;
			functions.transferEvent (move.ev.obj, move.to.obj);
			try { Host.GUI.flushUpdates (); } catch(e) {}
			if(spFindEventOnTrack (move.to.obj, move.ev) && !spFindEventOnTrack (move.from.obj, move.ev))
				return "transferEvent";
			log.add ("  transferEvent: 実行後の確認で移動が確認できず");
		}
		catch(e)
		{
			log.add ("  transferEvent: 例外 " + e);
		}
	}
	else
		log.add ("  transferEvent: 関数なし (" + typeof functions.transferEvent + ")");

	return null;
}

function spDescribeApi (context, log)
{
	var fn = context.functions;
	var names = ["transferEvent", "addEventOnTrack", "addEvent", "moveEvent", "removeEvent", "removeTrack",
	             "addMediaTrack", "duplicateTrack", "renameEvent", "beginMultiple", "endMultiple", "executeImmediately"];
	var parts = [];
	for(var i = 0; i < names.length; i++)
		parts.push (names[i] + "=" + spTypeOf (fn, names[i]));
	log.add ("functions: " + parts.join (", "));
	log.add ("context.editor=" + spTypeOf (context, "editor") + " mainTrackList=" + spTypeOf (context, "mainTrackList"));
}

function spGatherTracks (context, log)
{
	var tl = context.mainTrackList;
	var all = [];
	for(var i = 0; i < tl.numTracks; i++)
		all.push (tl.getTrack (i));

	var tracks = [];
	for(var k = 0; k < tl.numSelectedTracks; k++)
	{
		var t = tl.getSelectedTrack (k);
		if(!t)
			continue;
		var order = all.indexOf (t);
		if(order < 0)
			order = spSafe (function () { return t.trackIndex; }, 100000 + k);
		var info = {
			obj: t,
			key: "t" + order,
			order: order,
			name: spSafe (function () { return t.name; }, "?"),
			muted: !!spSafe (function () { return t.channel.mute; }, 0),
			layered: spSafe (function () { return t.layers.count; }, 1) > 1,
			isAudio: spSafe (function () { return t.mediaType; }, "Audio") == "Audio",
			isFolder: !!spSafe (function () { return t.isFolder; }, 0),
			events: []
		};
		if(info.isAudio && !info.isFolder)
			info.events = spCollectEvents (t);
		tracks.push (info);
		log.add ("track #" + order + " '" + info.name + "' muted=" + info.muted + " layered=" + info.layered +
		         " audio=" + info.isAudio + " events=" + info.events.length);
	}
	return tracks;
}

//////////////////////////////////////////////////////////////////////////////////////////////////
// EditTask
//////////////////////////////////////////////////////////////////////////////////////////////////

function StairPackTask (dryRun)
{
	this.interfaces = [Host.Interfaces.IEditTask];
	this.dryRun = dryRun;

	this.prepareEdit = function (context)
	{
		return Host.Results.kResultOk;
	};

	this.performEdit = function (context)
	{
		var log = new StairPackLog ();
		log.add ("StairPack " + STAIRPACK_VERSION + (this.dryRun ? " (診断のみ)" : "") + "  " + new Date ().toString ());
		var status = Host.Results.kResultOk;
		var message = "";
		try
		{
			var r = this.run (context, log);
			message = r.message;
			status = r.status;
		}
		catch(e)
		{
			log.add ("EXCEPTION: " + e + (e && e.stack ? "\n" + e.stack : ""));
			message = "エラーで中断しました: " + e;
			status = Host.Results.kResultFailed;
		}
		var where = log.flush ();
		try { Host.GUI.alert (message + (where ? "\n\n詳細ログ: ドキュメント\\Studio One\\stairpack_log.txt" : "")); } catch(e) {}
		return status;
	};

	this.run = function (context, log)
	{
		var functions = context.functions;
		var trackList = context.mainTrackList;
		if(!functions || !trackList)
		{
			log.add ("functions=" + typeof functions + " mainTrackList=" + typeof trackList);
			return { status: Host.Results.kResultFailed, message: "Studio Oneから必要な機能を取得できませんでした。" };
		}
		spDescribeApi (context, log);

		if(trackList.numSelectedTracks < 2)
			return { status: Host.Results.kResultOk,
			         message: "まとめたいトラック（例: main 1〜main 21）をトラックリストで選択してから実行してください。" };

		var tracks = spGatherTracks (context, log);
		var plan = stairPackPlan (tracks);
		for(var s = 0; s < plan.skipped.length; s++)
			log.add ("対象外: '" + plan.skipped[s].track.name + "' (" + plan.skipped[s].reason + ")");
		if(!plan.ok)
		{
			log.add ("計画失敗: " + plan.message);
			return { status: Host.Results.kResultOk, message: plan.message };
		}

		log.add ("計画: " + plan.lanes.length + "本に集約 / 移動 " + plan.moves.length + "個 / 削除予定 " + plan.removable.length + "本");
		for(var l = 0; l < plan.laneOf.length; l++)
		{
			var lo = plan.laneOf[l];
			log.add ("  [" + lo.ev.s.toFixed (3) + "-" + lo.ev.e.toFixed (3) + "] '" + lo.ev.name + "' : '" + lo.src.name +
			         "' -> レーン" + (lo.lane + 1) + " '" + plan.lanes[lo.lane].name + "'");
		}

		if(this.dryRun)
			return { status: Host.Results.kResultOk,
			         message: "診断のみ: " + plan.lanes.length + "本にまとめられます（移動 " + plan.moves.length + "個）。何も変更していません。" };

		if(plan.moves.length == 0 && plan.removable.length == 0)
			return { status: Host.Results.kResultOk, message: "すでにまとまっています。変更はありません。" };

		try { functions.executeImmediately = true; } catch(e) {}

		var moved = 0;
		var method = null;
		var state = { attempted: false };
		for(var i = 0; i < plan.moves.length; i++)
		{
			var mv = plan.moves[i];
			var used = spMoveEvent (context, functions, mv, log, state);
			if(!used)
			{
				log.add ("移動失敗: '" + mv.ev.name + "' '" + mv.from.name + "' -> '" + mv.to.name + "'");
				var msg;
				if(moved == 0 && !state.attempted)
					msg = "このStudio Oneではイベントをトラック間で移動する方法が見つかりませんでした。何も変更していません。ログをClaudeに見せてください。";
				else if(moved == 0)
					msg = "イベントの移動を試しましたが、正しく移動できたか確認できませんでした。念のため Ctrl+Z で元に戻してから、ログをClaudeに見せてください。";
				else
					msg = moved + "個移動したところで失敗しました。Ctrl+Z で元に戻せます。ログをClaudeに見せてください。";
				return { status: (moved == 0 && !state.attempted) ? Host.Results.kResultOk : Host.Results.kResultFailed, message: msg };
			}
			method = used;
			moved++;
		}
		log.add ("移動完了: " + moved + "個 (方法: " + method + ")");

		var removed = 0;
		if(typeof functions.removeTrack == "function")
		{
			for(var t = 0; t < plan.removable.length; t++)
			{
				var tr = plan.removable[t].obj;
				var empty = spSafe (function () { return tr.isEmpty (); }, 0);
				var envEmpty = spSafe (function () { return tr.envelopes.isEmpty (); }, 1);
				if(empty && envEmpty)
				{
					try { functions.removeTrack (tr); removed++; }
					catch(e) { log.add ("トラック削除失敗 '" + plan.removable[t].name + "': " + e); }
				}
				else
					log.add ("空でないため残す: '" + plan.removable[t].name + "' empty=" + empty + " env=" + envEmpty);
			}
		}
		else
			log.add ("removeTrack が無いため空トラックは残します");

		log.add ("削除: " + removed + "本");
		var kept = plan.removable.length - removed;
		return { status: Host.Results.kResultOk,
		         message: plan.lanes.length + "本にまとめました（移動 " + moved + "個、空トラック削除 " + removed + "本" +
		                  (kept > 0 ? "、空になったが残したトラック " + kept + "本" : "") + "）。\n元に戻すときは Ctrl+Z。" };
	};
}

//////////////////////////////////////////////////////////////////////////////////////////////////

function createStairPackTask ()
{
	return new StairPackTask (false);
}

function createStairPackDryRunTask ()
{
	return new StairPackTask (true);
}

// Node.js でのテスト用
if(typeof module !== "undefined" && module.exports)
	module.exports = { stairPackPlan: stairPackPlan, StairPackTask: StairPackTask };
