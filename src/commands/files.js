const Telegraf = require('telegraf');
const extend = require('xtend');
const tgd = require('telegraf-googledrive');
const replies = require('../replies');
const config = require('../config');
const oauthClient = require('../oauth');
const sequenceReply = require('../sequenceReply');
const statusCommand = require('../commands/status');

const replyTextMaxLength = 309;

const { rootId, fields } = config.drive;

// TODO bad function name
// this function does a lot more than just creating a keyboard
// it also replies the whole description to the user
const makeKeyboard = (ctx, next) => {
    // console.log('state folders', JSON.stringify(ctx.state.folders, ' ', 2));
    if (!ctx.state.folders) {
        console.error('folder no longer on state');
        return next();
    }
    const currentFolderId = ctx.state.rootId || rootId;
    const useCustomKeyboard = config.drive.useCustomKeyboard;
    // console.log({ useCustomKeyboard });
    const folders = ctx.state.folders[currentFolderId];
    // console.log({ folders });
    const filesKeyboard = folders.map(file => {
        const isSubFolder = (file.mimeType === 'application/vnd.google-apps.folder');
        const isReadme = file.name.toLowerCase() === 'readme.md';

        if (isReadme) { return null; }

        if (isSubFolder) {
            const parents = ctx.session.parents || {};
            const newParents = extend(parents, { [file.id]: file.parents[0] });
            ctx.session.parents = newParents;
            return [
                { text: file.name
                , callback_data: `changeFolder ${file.id}`
                }
            ];
        }
        return [
            { text: file.name
            , callback_data: `sendFile ${file.id}`
            }
        ];
    }).filter(i => i !== null);
    // console.log({ filesKeyboard });

    // console.log('ctx.state.defaultKeyboard', ctx.state.defaultKeyboard);
    
    const customSubfolders = config.drive.subFolderExtraButtons;
    // console.log({ currentFolderId });
    const customization = customSubfolders.filter(folder => folder.id === currentFolderId);
    // console.log({ customization });
    // console.log('customization.length', customization.length);
    const extraButtons = !customization || ctx.state.defaultKeyboard ? [] : customization.map(b => {
        const button =
            { text: b.text
            , callback_data: b.callbackData
            };
        return [ button ];
    });
    // console.log({ extraButtons });
    
    const inlineKeyboard = filesKeyboard.concat(
        ctx.state.defaultKeyboard || []
    ).concat(extraButtons);

    // console.log('inlineKeyboard', JSON.stringify(inlineKeyboard, ' ', 2));
    const keyboard = useCustomKeyboard
        ? { keyboard: inlineKeyboard.map(row => row.map(
            button => ({ text: button.text }))) }
        : { inline_keyboard: inlineKeyboard };
    if (useCustomKeyboard) {
        // console.log('customKeyboard', JSON.stringify(inlineKeyboard));
        const textCommands = inlineKeyboard.reduce((prev, buttonRow) => {
            if (!buttonRow.length) {
                return extend({}, prev);
            }
            const button = buttonRow[0];
            return extend({}, prev, { [button.text.trim()]: button.callback_data });
        }, {});
        ctx.session.textCommands = textCommands;
        ctx.session.lastMenu = inlineKeyboard;
    }
    const replyOptions = { reply_markup: keyboard, disable_web_page_preview: true };
    const folderDescription = ctx.state.folders.description
        || replies.docs.defaultDescription || '';
    const paragraphs = folderDescription.split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => line.slice(0, replyTextMaxLength));
    const justTitle = config.drive.parentMenuTitleOnly && ctx.state.navigatingUp;
    const lastParagraphIndex = justTitle ? 0 : paragraphs.length - 1;
    const lastReply = () => ctx.replyWithMarkdown(
        paragraphs[lastParagraphIndex], replyOptions
    ).then(next).catch(console.error);
    if (paragraphs.length) {
        return sequenceReply(ctx, paragraphs.slice(0, lastParagraphIndex))
            .then(lastReply);
    }
    return lastReply();
};

const filesToStateDefault = tgd.getFolder({ rootId, fields, auth: oauthClient });
const filesToStateWithoutRoot = tgd.getFolder({ fields, auth: oauthClient });

const filesToState = Telegraf.branch(ctx => ctx.state.rootId,
    filesToStateWithoutRoot,
    filesToStateDefault
);

/* Sets message description to ctx.state.folder.description from google drive README.md file
 */
const setDescription = tgd.setDescription(
    { path: config.drive.tempFolder
    , auth: oauthClient
    }
);

const callbackEnd = (ctx, next) => {
    if (ctx.updateType !== 'callback_query') {
        return next();
    }
    return ctx.editMessageReplyMarkup().then(() =>
        ctx.answerCallbackQuery().then(next).catch(console.error)
    );
};

const approvedUser = Telegraf.compose(
    [ filesToState
    , setDescription
    , callbackEnd
    , makeKeyboard
    ]);

const unapprovedUser = Telegraf.compose(statusCommand);

const command = Telegraf.branch(ctx => ctx.state.userIsApproved, approvedUser, unapprovedUser);
module.exports = [ command ];

