// NOTE: Reminder to disable this when deploying releases
const DEV_MODE = false;

const {Client, Intents, User} = require('discord.js');
const token = require('./auth-main.json');
const config = require('./package.json');

const TwitchAPI = require('node-twitch').default
const twitch = new TwitchAPI({
    client_id: token.twitch_client_id,
    client_secret: token.twitch_client_secret
});

const fs = require('fs');

const client = new Client({ intents: [Intents.FLAGS.GUILDS,
                                      Intents.FLAGS.GUILD_MESSAGES,
                                      Intents.FLAGS.GUILD_MESSAGE_REACTIONS] });

var riley_is_live = false;
var alt_is_live = false;

function getBaseLog(x, y) {
    return Math.log(y) / Math.log(x);
}

/** Taken from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
 * Gets a random int in the range [min, max).
 * 
 * @param {*} min The minimum number that can be picked
 * @param {*} max The maximum number that can be picked (exclusive)
 * @returns A random number between min and max
 */ 
function getRandomInt (min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min);
}

// Compare two user records. Returns the one with the most XP.
function compare_users(a, b) {
    if (a.xp < b.xp) {
      return -1;
    }
    if (a.xp > b.xp) {
      return 1;
    }
    // a must be equal to b
    return 0;
}

// User XP info. Contains uid, uname, mesgs, xp.
class UserRecord {
    constructor (uid, uname, mesgs, xp) {
        this.uid = uid;
        this.uname = uname;
        this.mesgs = mesgs;
        this.xp = xp;
    }

    sent_mesg () {
        this.mesgs++;
        this.xp += getRandomInt(10, 20);
    }
}

// XP handler
class XPHandler {
    constructor () {
        this.records = [];
    }

    // Calculate a user's level given XP amount.
    calc_level (xp) {
        return Math.floor(getBaseLog(1.3, xp) * 0.8 - 8);
    }

    // Load the user's data from file.
    from_file (fname) {
        fs.readFile(fname, 'utf8' , (err, data) => {
            var records = data.split("\n");

            for (var i = 1; i < records.length; i++) {
                var fields = records[i].split(',');
                this.records.push(new UserRecord(fields[0], fields[1], 
                                 parseInt(fields[2]), parseInt(fields[3])));
            }

          })
    }

    // Save all data about rankings to the file.
    to_file(fname) {
        var content = "UserId,Name,Mesg,Exp\n";
        for (var i = 0; i < this.records.length; i++) {
            content += this.records[i].uid + ',' +
                       this.records[i].uname + ',' +
                       this.records[i].mesgs + ',' +
                       this.records[i].xp;

            if (i != this.records.length - 1) content += '\n';
        }

        fs.writeFile(fname, content, err => {});
    }

    // Display info for !rank
    display_user_record (uid) {
        var user = this.records.find(e => e.uid === uid);
        var record = '```Username      : ' + user.uname + 
                     '\nMessages Sent : ' + user.mesgs +
                     '\nTotal XP      : ' + user.xp + 
                     '\nLevel         : ' + this.calc_level(user.xp) +'```';
        return record;
    }

    // Display all users, sorted in descending order by xp
    display_all_records () {
        // Sort all users in the list
        this.records.sort(compare_users);

        // Format the output and return it
        var output = ["```Username            | Messages Sent | Total XP | Level | Rank\n"];
        var j = 0;

        for (var i = 0; i < this.records.length; i++) {
            var item = this.records[i];

            if (item != undefined && item.uid != undefined) {
                var curr_name = item.uname.substr(0, 20);
                output[j] += curr_name
                output[j] += ' '.repeat(20 - curr_name.length);

                output[j] += "|";

                var curr_mesg = item.mesgs.toString();
                output[j] += ' '.repeat(14 - curr_mesg.length);
                output[j] += curr_mesg;
                output[j] += " |";

                var curr_xp = item.xp.toString();
                output[j] += ' '.repeat(9 - curr_xp.length);
                output[j] += curr_xp;
                output[j] += " |";
              
                var curr_lvl = this.calc_level(item.xp).toString();
                output[j] += ' '.repeat(6 - curr_lvl.length);
                output[j] += curr_lvl;
                output[j] += " |";

                var curr_rank = (this.records.length - i).toString();
                output[j] += ' '.repeat(5 - curr_rank.length);
                output[j] += curr_rank;
                output[j] += "\n";

                if (output[j].length > (2000 - 70)) {
                    output[j] += "```";
                    j++;
                    output.push("```");
                }
            }
        }

        output[j] += "```";
        return output;
    }

    // Update a user on sending a message.
    sent_mesg (uid, uname) {
        var user = this.records.find(e => e.uid === uid);
        // If the user isn't in the list, add them
        if (user === undefined) {
            user = new UserRecord(uid, uname, 0, 0);
            this.records.push(user);
        }

        var lvl = this.calc_level(user.xp);

        user.uname = uname;
        user.sent_mesg();

        var new_lvl = this.calc_level(user.xp);

        if (new_lvl > lvl) {
            bot_channel.send("GG " + user.uname + ", you just advanced to level " + new_lvl + "!");
        }
    }
}

var xp_handler = new XPHandler();

var exports_DM = undefined;

var assignable_role_dict = {
    "riley enthusiast": "706995928648908921",
    "all streams": "926838528254566440",
    "he/him": "865642390978560010",
    "she/her": "865642391448191007",
    "they/them": "865642392120328202"
}

// This code inspired by https://dev.to/thomasbnt/how-i-created-a-alert-live-twitch-404g
// Twitch Live checking interval (main account)
setInterval(async function() {
    await twitch.getStreams({ channel: "rrileytas" }).then(async data => {
        
        const r = data.data[0];
        
        if (r !== undefined) {
            // FRiley just went live, so fetch stream title and ping the discord
            if (r.type === "live" && !riley_is_live) {
                live_notif_channel.send("https://twitch.tv/rrileytas " + r.title + " <@&706995928648908921> <@&926838528254566440>");
            }
            riley_is_live = (r.type === "live");
        } else {
            riley_is_live = false;
        }
    })
}, 60000);

// Live checking (alt)
setInterval(async function() {
    await twitch.getStreams({ channel: "rileytas_2nd" }).then(async data => {
        
        const r = data.data[0];
        
        if (r !== undefined) {
            // FRiley just went live, so fetch stream title and ping the discord
            if (r.type === "live" && !alt_is_live) {
                live_notif_channel.send("https://twitch.tv/rileytas_2nd " + r.title + " <@&926838528254566440>");
            }
            alt_is_live = (r.type === "live");
        } else {
            alt_is_live = false;
        }
    })
}, 60000);

// Rankings autosave interval
setInterval(function() {
    xp_handler.to_file("rankings.csv");
    xp_handler.to_file("rankings_BU.csv");

    // DM saved rankings to Riley
    if (exports_DM != undefined) exports_DM.send({ files: ['./rankings.csv'] } );
}, 36000000);

client.once ('ready', () => {
	bot_channel = client.channels.cache.get("840201236485898240");
    if (!DEV_MODE) bot_channel.send("Bot has been restarted - please ensure everything is still correct!");

    live_notif_channel = client.channels.cache.get("743609450971136022");

    exports_DM = client.users.fetch("488841706859397125");

    xp_handler.from_file("rankings.csv");
    console.log('Ready!');
});

client.on ('messageCreate', message => {
    if (message.author.bot) return;

    xp_handler.sent_mesg(message.author.id, message.author.username);

    switch (message.content) {
        case '.ping':
            message.channel.send('Pong.');
            break;

        case '.help':
            var mesg = "```.ping - Test the bot. \n.rank - Display your rank.\n.levels - Show all ranks.\n.save (Mod only) - Save rankings to a file.\n.exit (Admin only) - Shuts down the bot.\n.help - Display this message.```";
            message.channel.send(mesg);
            break;

        case '.rank':
            var r = xp_handler.display_user_record(message.author.id, message.author.username);
            message.channel.send(r);
            break;

        case '.levels':
            // WARNING: This will not work well in servers with a large member count
            // as it needs to sort the list every time
            // and it displays all members (waits for discord's message cooldown a lot)
            var r = xp_handler.display_all_records();
            for (var i = 0; i < r.length; i++) {
                message.channel.send(r[i]);
            }

            break;

        case '.save':
            // Only do this if the person sending mesg is a mod
            if (message.member.roles.cache.some(role => role.name === 'Moderator')) {
                message.channel.send("Saving ranking data...");
                xp_handler.to_file("rankings.csv");
            } else {
                message.channel.send("You don't have the mod role, so you can't perform this operation!");
            }
            break;    

        case '.export':
            // Only do this if the person sending mesg is a Riley
            if (message.member.roles.cache.some(role => role.name === 'Riley')) {
                message.channel.send("Saving ranking data...");
                xp_handler.to_file("rankings.csv");

                message.channel.send("Check your DMs for the updated rankings.csv file.");
                message.author.send({ files: ['./rankings.csv'] } );
            } else {
                message.channel.send("You don't have the Riley role, so you can't perform this operation!");
            }
            break; 
            
    }

    // Adding/removing roles from user
    if (message.content.startsWith(".role add ")) {
        var author = message.guild.members.cache.get(message.author.id);
        var mesg = message.content.substring(10);

        var id = assignable_role_dict[mesg.toLowerCase()];
        if (id === undefined) {
            message.channel.send("That role doesn't exist, or I can't assign it");
        } else {
            var role = message.guild.roles.cache.get(id);
            author.roles.add(role);
            message.channel.send("Successfully given " + message.author.username + " the " + mesg + " role");
        }

    }

    else if (message.content.startsWith(".role remove ")) {
        var author = message.guild.members.cache.get(message.author.id);
        var mesg = message.content.substring(13);

        var id = assignable_role_dict[mesg.toLowerCase()];
        if (id === undefined) {
            message.channel.send("That role doesn't exist, or I can't remove it");
        } else {
            var role = message.guild.roles.cache.get(id);
            author.roles.remove(role);
            message.channel.send("Successfully removed " + message.author.username + " from the " + mesg + " role");
        }
    }
});

if (DEV_MODE) client.login(token.discord_test_token);
else client.login(token.discord_main_token);