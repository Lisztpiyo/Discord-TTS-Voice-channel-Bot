import {Readable} from 'stream';
import EventEmitter from 'events';
import Discord, {VoiceChannel, VoiceConnection} from "discord.js";

const client = new Discord.Client();
const {VoiceText} = require('voice-text');
const conf = require('config-reloadable');

const GoogleTts = require('google-translate-tts');

let config = conf();
const voiceLists1: any = {
    hikari: 'ひかり（女性）',
    haruka: 'はるか（女性）',
    takeru: 'たける（男性）',
    santa: 'サンタ',
    bear: '凶暴なクマ',
    show: 'ショウ（男性）'
};
const modeList1: any = {
    1: 'HOYA VoiceText API',
    2: 'Google Translate'
};

interface ReadObject {
    msg: string,
    cons: VoiceConnection,
    memberId?: string,
    msgId?: string
}

let context: VoiceConnection;
let discordToken: string;
let voiceTextApiKey = '';
let prefix = '/';
let urlReplaceText = 'URL省略';
let autoRestart = true;
let autoMessageRemove = false;
let readMe = false;
let allTextChannelRead = false;
let apiType = 1;
let voiceType = 'haruka';
let blackList: any;
let channelHistory: VoiceChannel;
let textChannelHistory: string;
let speed = 100;
let pitch = 100;
const timeoutOffset = 5;
let timeout = timeoutOffset;

function readConfig() {
    discordToken = config.get('Api.discordToken');
    voiceTextApiKey = config.get('Api.voiceTextApiKey');
    prefix = config.get('Prefix');
    urlReplaceText = config.get('UrlReplaceText');
    autoRestart = config.get('AutoRestart');

    autoMessageRemove = config.get('AutoMessageRemove');

    readMe = config.get('ReadMe');

    allTextChannelRead = config.get('AllTextChannelRead');

    apiType = config.get('Default.apiType');
    if (!modeList1[apiType]) throw new Error('Unknown api.');
    voiceType = config.get('Default.voiceType');
    if (!voiceLists1[voiceType]) throw new Error('Unknown voice.');
    blackList = config.get('BlackLists');
    return true;
}

const autoRestartFunc = () => {
    console.log(`${timeout}秒後に再接続処理開始`);
    setTimeout(() => {
        discordLogin().then();
    }, timeout * 1000);
    timeout *= 2;
};

const voiceChanelJoin = async (channelId: VoiceChannel | null | undefined) => {
    if (channelId == null) return false;
    channelHistory = channelId;
    await channelId.join()
        .then((connection) => {
            context = connection;
            return true;
        })
        .catch((err) => {
            console.log(err);
            return false;
        });
    return true;
};

const onErrorListen = (error: Error) => {
    if (context && context.status !== 4) context.disconnect();
    client.destroy();
    console.error(error.name);
    console.error(error.message);
    console.error(error);
    console.error('NOT CONNECT');
    if (error.name === 'Error [TOKEN_INVALID]') process.exit(1);
    autoRestart ? autoRestartFunc() : process.exit(1);
};

const discordLogin = async () => {
    console.log('DiscordBotログイン処理を実行');
    await client.login(discordToken); //Discord login token
    console.log('DiscordBotログイン処理を完了');
    console.log('ボイスチャンネルへの接続を試行');
    if (channelHistory && await voiceChanelJoin(channelHistory)) {
        console.log('ボイスチャンネルへ再接続成功');
    } else {
        console.log('直前に接続していたボイスチャンネル無し');
    }
    timeout = timeoutOffset;
};

readConfig();
const voicePattern1 = voiceType; //初期時のよみあげ音声
const userVoiceType: any = {}; //読み上げ音声ユーザーのmemberID別
let mode = apiType;
const voiceText = new VoiceText(voiceTextApiKey); //Voice Text API key

discordLogin().then();

process.on('uncaughtException', onErrorListen);

client.on('ready', () => {
    console.log('Bot準備完了');
});

client.on('message', (message) => {
    if (!message.guild) return;

    const promiseLogs = (r: Discord.Message) => r;

    const isBlackListsFromPrefixes = (str: string) => {
        const prefixes = blackList.get('prefixes');
        return prefixes.find((prefix: string) => str.indexOf(prefix) === 0);
    };

    const isBlackListsFromID = (menId: string) => {
        const memberIds = blackList.get('memberIds');
        return memberIds.find((id: string) => menId === id);
    };

    const isBot = () => {
        const bots = blackList.get('bots');
        return bots ? message.author.bot : false;
    };

    const isRead = (id: string) => !readMe ? id !== client.user?.id : readMe;

    const urlDelete = (str: string) => {
        const pat = /(https?:\/\/[\x21-\x7e]+)/g;
        return str.replace(pat, urlReplaceText);
    };

    const emojiDelete = (str: string) => {
        const pat = /(<:\w*:\d*>)/g;
        return str.replace(pat, '');
    };

    const mentionReplace = (str: string) => {
        const pat = /<@!(\d*)>/g;
        const [matchAllElement] = str.matchAll(pat);
        if (matchAllElement === undefined) return str;
        return str.replace(pat, <string>client.users.resolve(matchAllElement[1])?.username);
    };

    const messageAutoRemove = (obj: ReadObject) => {
        if (autoMessageRemove && obj.msg !== urlReplaceText) {
            obj.msgId != null ?
                message.channel.messages.fetch(obj.msgId).then((res) =>
                    res.delete({reason: '読み上げ後自動削除機能により削除'}))
                    .catch((error) => console.log(`エラーにより自動削除出来ませんでした。\n
                    Botにメッセージ管理のロールが与えられてるか確認してみてください。\n\n${error}`)) :
                console.log('読み上げたメッセージを特定出来なかったため自動削除出来ません');
        }
    };

    const read = (obj: ReadObject) => {
        if (obj.cons && obj.cons.status === 0 && (message.guild?.id === context.channel.guild.id)) {
            const sepMessage = obj.msg.match(/.{1,200}/g); //200以上の場合分割
            const emitter = new EventEmitter(); //イベント用意
            const readFunction = () => {//読み上げ機能
                if (sepMessage !== null) {
                    sepMessage.shift(); //queue処理
                    modeApi(obj).then((buffer) => {
                        const des = obj.cons.play(bufferToStream(buffer)); //保存されたWAV再生
                        des.on('finish', () => {
                            if (sepMessage.length > 0) {
                                emitter.emit('read'); //読み上げにまだ残りあるならイベント発火
                            } else {
                                messageAutoRemove(obj);
                            }
                        });
                        console.log(`${obj.msg}の読み上げ完了`);
                    }).catch((error) => {
                        console.log('error ->');
                        console.error(error);
                        message.channel.send(`${modeList1[mode]}の呼び出しにエラーが発生しました。\nエラー内容:${error.details[0].message}`, {code: true});
                    });
                }
            };
            emitter.on('read', () => readFunction()); //イベント受信で読み上げ実行
            readFunction();//最初の読み上げ
        } else {
            console.log('Botがボイスチャンネルへ接続してません。');
        }
    };

    const modeApi = (obj: ReadObject): Promise<Buffer> => {
        if (mode === 1) {
            const member = obj.memberId != null ? obj.memberId : "";
            return voiceText.fetchBuffer(obj.msg, {
                format: 'wav',
                speaker: userVoiceType[member] != null ? userVoiceType[member] : voicePattern1,
                pitch,
                speed
            });
        } else if (mode === 2) {
            return GoogleTts.synthesize({
                text: obj.msg,
                voice: 'ja'
            });
        } else {
            throw Error(`不明なAPIが選択されています:${mode}`);
        }
    };

    const bufferToStream = (buffer: Buffer) => {
        const stream = new Readable();
        stream.push(buffer);
        stream.push(null);
        return stream;
    };

    const changeParameter = (mess: string, text: string, para: number) => {
        const split = mess.split(' ');
        if (mode === 1) {
            if (1 < split.length && Number(split[1]) <= 200 && Number(split[1]) >= 50) {
                message.channel.send(`読み上げ音声の${text}を${split[1]}に変更しました。`, {code: true});
                return Number(split[1]);
            } else {
                message.reply(`読み上げ音声の${text}は 50 ～ 200 の範囲内で設定してください`).then(promiseLogs);
                return para;
            }
        }
        return para;
    };

    if (message.content === `${prefix}join`) {
        if (message.member != null && message.member.voice.channel) {
            if (!context || (context && context.status === 4)) {
                if (voiceChanelJoin(message.member.voice.channel)) {
                    textChannelHistory = message.channel.id;
                    console.log('ボイスチャンネルへ接続しました。');
                    message.channel.send('ボイスチャンネルへ接続しました。', {code: true});
                    message.reply(`\nチャットの読み上げ準備ができました。切断時は${prefix}killです。\n${
                        prefix}mode で読み上げAPIを変更できます。\n ${prefix
                    }voiceでよみあげ音声を選択できます。\n 音声が読み上げられない場合は${prefix}reconnectを試してみてください。`).then(promiseLogs);
                }
            } else {
                message.reply('既にボイスチャンネルへ接続済みです。').then(promiseLogs);
            }
        } else {
            message.reply('まずあなたがボイスチャンネルへ接続している必要があります。').then(promiseLogs);
        }
    }

    if (message.content === `${prefix}reconnect`) {
        if (context && context.status !== 4) {
            context.disconnect();
            message.channel.send('5秒後にボイスチャンネルへ再接続します。', {code: true});
            if (message.member != null && message.member.voice.channel) {
                setTimeout(() => {
                    if (voiceChanelJoin(message.member?.voice.channel)) {
                        textChannelHistory = message.channel.id;
                        console.log('ボイスチャンネルへ再接続しました。');
                        message.channel.send('ボイスチャンネルへ再接続しました。', {code: true});
                    }
                }, 5000);
            } else {
                message.reply('まずあなたがボイスチャンネルへ接続している必要があります。').then(promiseLogs);
            }
        } else {
            message.reply('Botはボイスチャンネルに接続していないようです。').then(promiseLogs);
        }
    }

    if (message.content === `${prefix}kill`) {
        if (context && context.status !== 4) {
            context.disconnect();
            message.channel.send(':dash:');
        } else {
            message.reply('Botはボイスチャンネルに接続していないようです。').then(promiseLogs);
        }
    }

    if (message.content.indexOf(`${prefix}mode`) === 0) {
        const split = message.content.split(' ');
        if (1 < split.length) {
            if (modeList1[split[1]] != null) {
                mode = Number(split[1]);
                const modeMessage = `読み上げAPIを${split[1]} : ${modeList1[split[1]]}に設定しました。`;
                message.reply(modeMessage).then(promiseLogs);
                read({
                    msg: modeMessage,
                    cons: context
                });
            } else {
                mode = Number(split[1]);
                message.reply(`指定されたAPIが不正です。指定可能なAPIは${prefix}modeで見ることが可能です。`).then(promiseLogs);
            }
        } else {
            let modeNames = `\n以下のAPIに切り替え可能です。 指定時の例：${prefix}mode 1\n`;
            for (const indexes in modeList1) {
                if (modeList1.hasOwnProperty(indexes))
                    modeNames = `${modeNames + indexes} -> ${modeList1[indexes]}\n`;
            }
            message.reply(modeNames).then(promiseLogs);
        }

    }

    if (message.content === `${prefix}type`) {
        let typeMessage = '\n音声タイプ -> その説明\n';
        if (mode === 1) {
            for (const voiceLists1Key in voiceLists1) {
                if (voiceLists1.hasOwnProperty(voiceLists1Key))
                    typeMessage = `${typeMessage + voiceLists1Key}->${voiceLists1[voiceLists1Key]}\n`;
            }
        } else {
            typeMessage = `${typeMessage}APIが不正です`;
        }
        message.reply(typeMessage).then(promiseLogs);
    }

    if (message.content.indexOf(`${prefix}voice`) === 0) {
        const split = message.content.split(' ');
        if (mode === 1) {
            if (1 < split.length) {
                if (voiceLists1[split[1]] != null) {
                    userVoiceType[message.member?.id!] = split[1];
                    const voiceMessage = `読み上げ音声を${split[1]} : ${voiceLists1[split[1]]}に設定しました。`;
                    message.reply(voiceMessage).then(promiseLogs);
                    read({
                        msg: voiceMessage,
                        cons: context
                    });
                } else {
                    message.reply(`指定された読み上げ音声タイプが不正です。指定可能な音声タイプは${prefix}typeで見ることが可能です。`).then(promiseLogs);
                }
            } else {
                message.reply(`読み上げ音声タイプを指定する必要があります。例：${prefix}voice hikari 指定可能な音声タイプは${prefix}typeで見ることが可能です。`).then(promiseLogs);
            }
        } else {
            message.reply('このAPIでは音声タイプを変更出来ません。').then(promiseLogs);
        }
    }

    if (message.content === `${prefix}reload`) {
        config = conf.reloadConfigs();
        if (readConfig()) message.channel.send('コンフィグを再読み込みしました。');
    }

    if (message.content.indexOf(`${prefix}pitch`) === 0) {
        pitch = changeParameter(message.content, '高さ', pitch);
    }

    if (message.content.indexOf(`${prefix}speed`) === 0) {
        speed = changeParameter(message.content, '速度', speed);
    }

    if (message.member != null && !(isBot() || isBlackListsFromID(message.member.id)
        || isBlackListsFromPrefixes(message.content)) && isRead(message.member.id)) {
        if (message.channel.id === textChannelHistory || allTextChannelRead) {
            try {
                read({
                    msg: mentionReplace(emojiDelete(urlDelete(message.content))),
                    cons: context,
                    memberId: message.member.id,
                    msgId: message.id
                });
            } catch (error) {
                console.log(error.message);
                message.channel.send(error.message, {code: true});
            }
        } else {
            console.log('Join,Reconnectコマンドが実行されたテキストチャンネル以外です');
        }
    } else {
        console.log('読み上げ対象外のチャットです');
    }

});