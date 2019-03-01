var express = require("express");
var bodyParser = require("body-parser");
var https = require("https");
var fs = require("fs");
var cors = require("cors");
var axios = require("axios");

var app = express();

app.use(bodyParser.json());
app.use(cors());

const global = {
	DEBUG_MESSAGES: false,
	FAIL_LIMIT: 2,
	cache: []
};

const essentialLog = console.log.bind(this);
if(!global.DEBUG_MESSAGES) {console.log = () => {};}

const options = {
	cert: fs.readFileSync("./fullchain.pem"),
	key: fs.readFileSync("./privkey.pem")
};

app.get("/save", async(req, res) => {
	fs.writeFileSync("savestate.json", JSON.stringify(global.cache));
	res.send("Finished save routine");
});

app.get("/", async (req, res) => {

	const logTime = new Date().toLocaleString("en-US");
	essentialLog(`${logTime}: Request from ${req.connection.remoteAddress}`);

	let fastTrackReply = false;
	let replySent = false;

	const requesterIds = (req.query.ids || "").split(",");

	console.log("User wants IDs:");
	console.log(requesterIds);

	const requesterIdsToFetch = requesterIds.filter(id => (global.cache[id] === undefined || global.cache[id] === null) || (global.cache[id].failCount !== undefined && global.cache[id].failCount < global.FAIL_LIMIT));

	if(requesterIdsToFetch.length > 0) {

		// Cache the lack of a response as well (All requested IDs are added to the cache regardless of whether data is actually returned from the TO API)
		for(const requesterId of requesterIdsToFetch) {
			(global.cache[requesterId] === null || global.cache[requesterId] === undefined) ? global.cache[requesterId] = {failCount: 0} : (0);
		}

		console.log("These IDs aren't in cache:");
		for(const rid of requesterIdsToFetch) {
			console.log(rid, global.cache[rid]);
		}
		console.log("Fetching from TO...");

		let rawResponse;

		try {
			if(req.query.fastTrack !== undefined) {
				setTimeout(() => {
					if(replySent) {return;}

					const requestersResponse = requesterIds.reduce((acc, item) => {
						const fromCache = {...global.cache[item]};
						if(!!fromCache && typeof fromCache !== "string" && Object.keys(fromCache).length > 0 && fromCache.failCount === undefined) {
							acc[item] = {...global.cache[item]};
						}
						else {
							acc[item] = ""
						}
						return acc;
					}, {});

					const response = JSON.stringify(requestersResponse);

					console.log("Sending FAST-TRACK response:");
					console.log(response);

					res.setHeader("Content-Type", "text/html");
					res.send(response);

					replySent = true;
					fastTrackReply = true;

				}, +req.query.fastTrack);
			}

			rawResponse = await axios.get(`http://169.228.47.34/api/multi-attrs.php?ids=${requesterIdsToFetch.join(",")}`, {
				headers: {
					"Referer": "https://worker.mturk.com/?hit_forker",
					"Origin": "https://worker.mturk.com",
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36",
				}
			});
		} catch(err) {
		}

	        if(rawResponse) {

			const responseData = rawResponse.data;

			const requesterInfo = responseData;

			console.log("Got this response from TO to add to local cache:");
			console.log(requesterInfo);

			const responseKeys = Object.keys(requesterInfo);

			for(const responseKey of responseKeys) {
				global.cache[responseKey] = {...requesterInfo[responseKey]};
			}
			// global.cache = {...global.requesterInfo, ...global.cache};

		}
		else {
			console.log("Did not get a response from TO for request.");
			for(const rid of requesterIdsToFetch) {
				if(global.cache[rid].failCount !== undefined) {
					global.cache[rid].failCount++;
					console.log(`${rid} failCount increased to ${global.cache[rid].failCount}`);
				}
			}
		}
	}

	if(fastTrackReply) {return;}

	const requestersResponse = requesterIds.reduce((acc, item) => {
		const fromCache = {...global.cache[item]};
		if(!!fromCache && typeof fromCache !== "string" && Object.keys(fromCache).length > 0 && fromCache.failCount === undefined) {
			acc[item] = {...global.cache[item]};
		}
		else {
			acc[item] = ""
		}
		return acc;
	}, {});

	const response = JSON.stringify(requestersResponse);

	console.log("Sending response:");
	console.log(response);

	res.setHeader("Content-Type", "text/html");
	res.send(response);
	
	replySent = true;
});

const CACHE_TTL_AS_HRS = 72;
const CACHE_TTL_AS_MINS = CACHE_TTL_AS_HRS * 60;
const CACHE_TTL_AS_SECS = CACHE_TTL_AS_MINS * 60;
const CACHE_TTL_AS_MS = Math.floor(CACHE_TTL_AS_SECS * 1000);

setTimeout(() => {
	fs.writeFileSync("flushedCache.txt", JSON.stringify(global.cache));
	global.cache = []
}, CACHE_TTL_AS_MS);

const PORTS = {
	HTTP: 13378,
	HTTPS: 13379
};

if(fs.existsSync("savestate.json")) {
	global.cache = JSON.parse(fs.readFileSync("savestate.json"));
	fs.unlinkSync("savestate.json");
}

app.listen(PORTS.HTTP, "0.0.0.0", () => essentialLog(`TO Cache online. Ports: HTTP ${PORTS.HTTP} HTTPS ${PORTS.HTTPS}`));
https.createServer(options, app).listen(PORTS.HTTPS);
