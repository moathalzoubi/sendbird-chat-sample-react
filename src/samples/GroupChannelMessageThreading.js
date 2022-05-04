import { useState, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import SendbirdChat, { UserUpdateParams } from '@sendbird/chat';

import {
  GroupChannelHandler,
  GroupChannelModule,
  GroupChannelCreateParams,
} from '@sendbird/chat/groupChannel';

import {
  UserMessageCreateParams,
  MessageListParams,
  UserMessageUpdateParams,
  FileMessageCreateParams,
  MessageRetrievalParams,
  ThreadedMessageListParams
} from '@sendbird/chat/message';

import { SENDBIRD_INFO } from '../constants/constants';
import { timestampToTime } from '../utils/messageUtils';
let sb;

const GroupChannelMessageThreading = (props) => {
  const [state, updateState] = useState({
    applicationUsers: [],
    groupChannelMembers: [],
    currentlyJoinedChannel: null,
    threadParentsMessage: {},
    threadMessages: [],
    messages: [],
    channels: [],
    threadMessageInputValue: "",
    messageInputValue: "",
    userNameInputValue: "",
    userIdInputValue: "",
    channelNameUpdateValue: "",
    isOpenThread: false,
    settingUpUser: true,
    file: null,
    threadFile: null,
    messageToUpdate: null,
    loading: false,
    error: false,
    messageSentByYou: false
  });

  //need to access state in message received callback
  const stateRef = useRef();
  stateRef.current = state;

  const onError = (error) => {
    updateState({ ...state, error: error.message });
    console.log(error);
  }

  const handleJoinChannel = async (channelUrl) => {
    const { channels } = state;
    updateState({ ...state, loading: true });
    const channel = channels.find((channel) => channel.url === channelUrl);
    const [messages, error] = await joinChannel(channel);
    if (error) {
      return onError(error);
    }
    // listen for incoming messages
    const channelHandler = new GroupChannelHandler();
    channelHandler.onUserJoined = () => { };
    channelHandler.onChannelChanged = () => { };
    channelHandler.onMessageUpdated = (channel, message) => {
      const messageIndex = stateRef.current.messages.findIndex((item => item.messageId == message.messageId));
      const updatedMessages = [...stateRef.current.messages];
      updatedMessages[messageIndex] = message;
      updateState({ ...stateRef.current, messages: updatedMessages });
    }

    channelHandler.onMessageReceived = (channel, message) => {
      if(!message.parentMessageId) {
        const updatedMessages = [...stateRef.current.messages, message];
        updateState({ ...stateRef.current, messages: updatedMessages });
      } else {
        const updatedMessages = [...stateRef.current.threadMessages, message];
        updateState({ ...stateRef.current, threadMessages: updatedMessages });
      }
    };

    channelHandler.onMessageDeleted = (channel, message) => {
      const updatedMessages = stateRef.current.messages.filter((messageObject) => {
        return messageObject.messageId !== message;
      });
      updateState({ ...stateRef.current, messages: updatedMessages });
    };
    sb.groupChannel.addGroupChannelHandler(uuid(), channelHandler);
    updateState({ ...state, currentlyJoinedChannel: channel, messages: messages, loading: false })
  }

  const handleLeaveChannel = async () => {
    const { currentlyJoinedChannel } = state;
    await currentlyJoinedChannel.leave();

    updateState({ ...state, currentlyJoinedChannel: null })
  }

  const handleCreateChannel = async (channelName = "testChannel",) => {
    const [groupChannel, error] = await createChannel(channelName, state.groupChannelMembers);
    if (error) {
      return onError(error);
    }

    const updatedChannels = [groupChannel, ...state.channels];
    updateState({ ...state, channels: updatedChannels, applicationUsers: [] });
  }

  const handleUpdateChannelMembersList = async () => {
    const { currentlyJoinedChannel, groupChannelMembers } = state;
    await inviteUsersToChannel(currentlyJoinedChannel, groupChannelMembers);
    updateState({ ...state, applicationUsers: [] });
  }

  const handleDeleteChannel = async (channelUrl) => {
    const [channel, error] = await deleteChannel(channelUrl);
    if (error) {
      return onError(error);
    }
    const updatedChannels = state.channels.filter((channel) => {
      return channel.url !== channelUrl;
    });
    updateState({ ...state, channels: updatedChannels });
  }

  const handleMemberInvite = async () => {
    const [users, error] = await getAllApplicationUsers();
    if (error) {
      return onError(error);
    }
    updateState({ ...state, applicationUsers: users });
  }

  const onUserNameInputChange = (e) => {
    const userNameInputValue = e.currentTarget.value;
    updateState({ ...state, userNameInputValue });
  }

  const onUserIdInputChange = (e) => {
    const userIdInputValue = e.currentTarget.value;
    updateState({ ...state, userIdInputValue });
  }

  const onMessageInputChange = (e) => {
    const messageInputValue = e.currentTarget.value;
    updateState({ ...state, messageInputValue });
  }

  const onThreadMessageInputChange = (e) => {
    const threadMessageInputValue = e.currentTarget.value;
    updateState({ ...state, threadMessageInputValue });
  }

  const userMessagesHandler = (isThread, userMessageParams, messages) => {
    const { currentlyJoinedChannel } = state;

    if (isThread) {
      userMessageParams.message = state.threadMessageInputValue;
    } else {
      userMessageParams.message = state.messageInputValue;
    }

    currentlyJoinedChannel.sendUserMessage(userMessageParams).onSucceeded((message) => {
      const updatedMessages = [...messages, message];
      updateState(() => {
        if (isThread) {
          return { ...state, threadMessages: updatedMessages, threadMessageInputValue: "" }
        }

        return { ...state, messages: updatedMessages, messageInputValue: "" }
      });

    }).onFailed((error) => {
      console.log(error)
      console.log("failed")
    });
  }

  const sendMessage = async () => {
    const { messageToUpdate, currentlyJoinedChannel, messages } = state;
    if (messageToUpdate) {
      const userMessageUpdateParams = new UserMessageUpdateParams();
      userMessageUpdateParams.message = state.messageInputValue;
      const updatedMessage = await currentlyJoinedChannel.updateUserMessage(messageToUpdate.messageId, userMessageUpdateParams)
      const messageIndex = messages.findIndex((item => item.messageId == messageToUpdate.messageId));
      messages[messageIndex] = updatedMessage;
      updateState({ ...state, messages: messages, messageInputValue: "", messageToUpdate: null });
    } else {
      const userMessageParams = new UserMessageCreateParams();

      userMessageParams.message = state.messageInputValue;

      userMessagesHandler(false, userMessageParams, messages)
    }
  }

  const sendThreadMessage = async () => {
    const { threadMessages, threadParentsMessage } = state;
    const userMessageParams = new UserMessageCreateParams({ parentMessageId: threadParentsMessage.messageId });

    userMessageParams.message = state.threadMessageInputValue;

    userMessagesHandler(true, userMessageParams, threadMessages)
  }

  const fileMessagesHandler = (fileMessageParams, messages, isThread, event) => {
    const { currentlyJoinedChannel } = state;
    fileMessageParams.file = event.currentTarget.files[0];

    currentlyJoinedChannel.sendFileMessage(fileMessageParams).onSucceeded((message) => {
      const updatedMessages = [...messages, message];
      updateState(() => {
        if (isThread) {
          return { ...state, threadMessages: updatedMessages, threadMessageInputValue: "", threadFile: null }
        }

        return { ...state, messages: updatedMessages, messageInputValue: "", file: null }
      });

    }).onFailed((error) => {
      console.log(error)
      console.log("failed")
    });
  }

  const onFileInputChange = async (e) => {
    if (e.currentTarget.files && e.currentTarget.files.length > 0) {
      const { messages } = state;
      const fileMessageParams = new FileMessageCreateParams();
      
      fileMessagesHandler(fileMessageParams, messages, false, e);
    }
  }

  const onFileThreadInputChange = async (e) => {
    if (e.currentTarget.files && e.currentTarget.files.length > 0) {
      const { threadMessages, threadParentsMessage } = state;
      const fileMessageParams = new FileMessageCreateParams({parentMessageId: threadParentsMessage.messageId});

      fileMessagesHandler(fileMessageParams, threadMessages, true, e);
    }
  }

  const handleDeleteMessage = async (messageToDelete) => {
    const { currentlyJoinedChannel } = state;
    await deleteMessage(currentlyJoinedChannel, messageToDelete); // Delete
  }

  const updateMessage = async (message) => {
    updateState({ ...state, messageToUpdate: message, messageInputValue: message.message });
  }

  const openThread = async (parentsMessage) => {
    const { currentlyJoinedChannel } = state;

    const messageSentByYou = parentsMessage.sender.userId === sb.currentUser.userId;
    const { params, threadedMessages} = await getParamsForThreading(parentsMessage, currentlyJoinedChannel)
    const message = await sb.message.getMessage(params);

    updateState({ ...state, isOpenThread: true, threadParentsMessage: message, threadMessages: threadedMessages, messageSentByYou: messageSentByYou })
  }

  const exitThread = async () => {
    updateState({ ...state, isOpenThread: false })
  }

  const handleLoadMemberSelectionList = async () => {
    updateState({ ...state, currentlyJoinedChannel: null });
    const [users, error] = await getAllApplicationUsers();
    if (error) {
      return onError(error);
    }
    updateState({ ...state, currentlyJoinedChannel: null, applicationUsers: users, groupChannelMembers: [sb.currentUser.userId] });
  }

  const addToChannelMembersList = (userId) => {
    const groupChannelMembers = [...state.groupChannelMembers, userId];
    updateState({ ...state, groupChannelMembers: groupChannelMembers });
  }

  const setupUser = async () => {
    const { userNameInputValue, userIdInputValue } = state;
    const sendbirdChat = await SendbirdChat.init({
      appId: SENDBIRD_INFO.appId,
      localCacheEnabled: false,
      modules: [new GroupChannelModule()]
    });

    await sendbirdChat.connect(userIdInputValue);
    await sendbirdChat.setChannelInvitationPreference(true);

    const userUpdateParams = new UserUpdateParams();
    userUpdateParams.nickname = userNameInputValue;
    userUpdateParams.userId = userIdInputValue;
    await sendbirdChat.updateCurrentUserInfo(userUpdateParams);

    sb = sendbirdChat;
    updateState({ ...state, loading: true });
    const [channels, error] = await loadChannels();
    if (error) {
      return onError(error);
    }
    console.log(sb.currentUser.userId);
    updateState({ ...state, channels: channels, loading: false, settingUpUser: false });
  }

  if (state.loading) {
    return <div>Loading...</div>
  }

  if (state.error) {
    return <div className="error">{state.error} check console for more information.</div>
  }

  console.log('- - - - State object very useful for debugging - - - -');
  console.log(state);

  return (
    <>
      <CreateUserForm
        setupUser={setupUser}
        userNameInputValue={state.userNameInputValue}
        userIdInputValue={state.userIdInputValue}
        settingUpUser={state.settingUpUser}
        onUserIdInputChange={onUserIdInputChange}
        onUserNameInputChange={onUserNameInputChange} />
      <ChannelList
        channels={state.channels}
        handleJoinChannel={handleJoinChannel}
        handleCreateChannel={handleLoadMemberSelectionList}
        handleDeleteChannel={handleDeleteChannel}
        handleLoadMemberSelectionList={handleLoadMemberSelectionList} />
      <MembersSelect
        applicationUsers={state.applicationUsers}
        groupChannelMembers={state.groupChannelMembers}
        currentlyJoinedChannel={state.currentlyJoinedChannel}
        addToChannelMembersList={addToChannelMembersList}
        handleCreateChannel={handleCreateChannel}
        handleUpdateChannelMembersList={handleUpdateChannelMembersList}
      />
      <Channel currentlyJoinedChannel={state.currentlyJoinedChannel} handleLeaveChannel={handleLeaveChannel}>
        <MessagesList
          messages={state.messages}
          handleDeleteMessage={handleDeleteMessage}
          updateMessage={updateMessage}
          openThread={openThread}
        />
        <MessageInput
          value={state.messageInputValue}
          onChange={onMessageInputChange}
          sendMessage={sendMessage}
          fileSelected={state.file}
          isOpenThread={state.isOpenThread}
          onFileInputChange={onFileInputChange} />
      </Channel>
      <Thread
        messageSentByYou={state.messageSentByYou}
        isOpenThread={state.isOpenThread}
        openThread={openThread}
        exitThread={exitThread}
        handleDeleteMessage={handleDeleteMessage}
        updateMessage={updateMessage}
        threadParentsMessage={state.threadParentsMessage}
      >
        <MessagesList
          isOpenThread={state.isOpenThread}
          messages={state.threadMessages}
          handleDeleteMessage={handleDeleteMessage}
          updateMessage={updateMessage}
        />
        <MessageInput
          threadInputClass={"thread-input"}
          value={state.threadMessageInputValue}
          isOpenThread={state.isOpenThread}
          isThread={true}
          onChange={onThreadMessageInputChange}
          sendMessage={sendThreadMessage}
          fileSelected={state.threadFile}
          onFileThreadInputChange={onFileThreadInputChange} />
      </Thread>
      <MembersList
        channel={state.currentlyJoinedChannel}
        handleMemberInvite={handleMemberInvite}
      />
    </>
  );
};

// Chat UI Components
const ChannelList = ({
  channels,
  handleJoinChannel,
  handleDeleteChannel,
  handleLoadMemberSelectionList
}) => {
  return (
    <div className='channel-list'>
      <div className="channel-type">
        <h1>Group Channels</h1>
        <button className="channel-create-button" onClick={() => handleLoadMemberSelectionList()}>Create Channel</button>
      </div>
      {channels.map(channel => {
        return (
          <div key={channel.url} className="channel-list-item" >
            <div
              className="channel-list-item-name"
              onClick={() => { handleJoinChannel(channel.url) }}>
              <ChannelName members={channel.members} />
              <div className="last-message">{channel.lastMessage?.message}</div>
            </div>
            <div>
              <button className="control-button" onClick={() => handleDeleteChannel(channel.url)}>
                <img className="channel-icon" src='/icon_delete.png' />
              </button>
            </div>
          </div>);
      })}
    </div >);
}

const ChannelName = ({ members }) => {
  const membersToDisplay = members.slice(0, 2);
  const membersNotToDisplay = members.slice(2);

  return <>
    {membersToDisplay.map((member) => {
      return <span key={member.userId}>{member.nickname} </span>
    })}
    {membersNotToDisplay.length > 0 && `+ ${membersNotToDisplay.length}`}
  </>
}


const Channel = ({ currentlyJoinedChannel, children, handleLeaveChannel }) => {
  if (currentlyJoinedChannel) {
    return <div className="channel">
      <ChannelHeader>{currentlyJoinedChannel.name}</ChannelHeader>
      <div>
        <button className="leave-channel" onClick={handleLeaveChannel}>Leave Channel</button>
      </div>
      <div>{children}</div>
    </div>;
  }
  return <div className="channel"></div>;
}

const Thread = ({ isOpenThread, exitThread, children, threadParentsMessage, handleDeleteMessage, updateMessage, messageSentByYou}) => {
  return isOpenThread && (
    <div className="channel thread">
      <ChannelHeader>Thread</ChannelHeader>
      <div>
        <button className="leave-channel" onClick={() => exitThread()}>Exit Thread</button>
      </div>
      <div className={`message-item ${messageSentByYou ? 'message-from-you' : ''}`}>
        <Message
          isOpenThread={isOpenThread}
          handleDeleteMessage={handleDeleteMessage}
          updateMessage={updateMessage}
          message={threadParentsMessage}
          messageSentByYou={messageSentByYou}
        />
      </div>
      <div className="underline" />
      <div>{children}</div>
    </div>
  )
}

const ChannelHeader = ({ children }) => {
  return <div className="channel-header">{children}</div>;
}

const MembersList = ({ channel, handleMemberInvite }) => {
  if (channel) {
    return <div className="members-list">
      <button onClick={handleMemberInvite}>Invite</button>
      {channel.members.map((member) =>
        <div className="member-item" key={member.userId}>{member.nickname}</div>
      )}
    </div>;
  } else {
    return null;
  }
}

const MessagesList = ({ messages, handleDeleteMessage, updateMessage, openThread, isOpenThread }) => {
  return <div className="message-list">
    {messages.map(message => {
      const messageSentByYou = message.sender.userId === sb.currentUser.userId;

      return (
        <div key={message.messageId} className={`message-item ${messageSentByYou ? 'message-from-you' : ''}`}>
          <Message
            isOpenThread={isOpenThread}
            message={message}
            openThread={openThread}
            handleDeleteMessage={handleDeleteMessage}
            updateMessage={updateMessage}
            messageSentByYou={messageSentByYou} />
          <ProfileImage user={message.sender} />
        </div>);
    })}
  </div >
}

const Message = ({ message, updateMessage, handleDeleteMessage, messageSentByYou, openThread, isOpenThread }) => {
  if (message.url) {
    return (
      <div className={`message  ${messageSentByYou ? 'message-from-you' : ''}`}>
        <div className="message-user-info">
          <div className="message-sender-name">{message.sender.nickname}{' '}</div>
          <div>{timestampToTime(message.createdAt)}</div>
        </div>
        <img src={message.url} />
        {!isOpenThread && <button className={`control-button ${isOpenThread ? "display-none" : ""}`} onClick={() => openThread(message)}>
          <img className="message-icon" src='/icon_thread.png' />
        </button>}
      </div >);
  }
  const messageSentByCurrentUser = message.sender.userId === sb.currentUser.userId;

  return (
    <div className={`message  ${messageSentByYou ? 'message-from-you' : ''}`}>
      <div className="message-info">
        <div className="message-user-info">
          <div className="message-sender-name">{message.sender.nickname}{' '}</div>
          <div>{timestampToTime(message.createdAt)}</div>
        </div>
        {messageSentByCurrentUser &&
          <div>
            <button className={`control-button ${isOpenThread ? "display-none" : ""}`} onClick={() => updateMessage(message)}><img className="message-icon" src='/icon_edit.png' /></button>
            <button className={`control-button ${isOpenThread ? "display-none" : ""}`} onClick={() => handleDeleteMessage(message)}><img className="message-icon" src='/icon_delete.png' /></button>
            {!isOpenThread && 
            <button className={`control-button ${isOpenThread ? "display-none" : ""}`} onClick={() => openThread(message)}>
              <img className="message-icon" src='/icon_thread.png' />
            </button>}
          </div>}

          {!messageSentByCurrentUser && !isOpenThread && 
            <button className={`control-button ${isOpenThread ? "display-none" : ""}`} onClick={() => openThread(message)}>
              <img className="message-icon" src='/icon_thread.png' />
            </button>}
      </div>
      <div>{message.message}</div>
    </div >
  );
}

const ProfileImage = ({ user }) => {
  if (user.plainProfileUrl) {
    return <img className="profile-image" src={user.plainProfileUrl} />
  } else {
    return <div className="profile-image-fallback">{user.nickname.charAt(0)}</div>;
  }
}

const MessageInput = ({ value, onChange, sendMessage, onFileInputChange, isOpenThread, threadInputClass = "", onFileThreadInputChange, isThread = false }) => {
  return (
    <div className={`message-input ${threadInputClass} ${isOpenThread ? "message-input-column" : ""}`}>
      <input
        placeholder="write a message"
        value={value}
        onChange={onChange} />

      <div className="message-input-buttons">
        <button className="send-message-button" onClick={sendMessage}>Send Message</button>
        {isThread ? <><label className="file-upload-label" htmlFor="threadUpload" >Select File</label>

          <input
            id="threadUpload"
            className="file-upload-button"
            type='file'
            hidden={true}
            onChange={onFileThreadInputChange}
            onClick={() => { }}
          /></> : <><label className="file-upload-label" htmlFor="upload" >Select File</label>

          <input
            id="upload"
            className="file-upload-button"
            type='file'
            hidden={true}
            onChange={onFileInputChange}
            onClick={() => { }}
          /></>}
      </div>
    </div>);
}

const MembersSelect = ({
  applicationUsers,
  groupChannelMembers,
  currentlyJoinedChannel,
  addToChannelMembersList,
  handleCreateChannel,
  handleUpdateChannelMembersList
}) => {
  if (applicationUsers.length > 0) {
    return <div className="overlay">
      <div className="overlay-content">
        <button onClick={() => {
          if (currentlyJoinedChannel) {
            handleUpdateChannelMembersList();
          } else {
            handleCreateChannel();
          }
        }}>{currentlyJoinedChannel ? 'Submit' : 'Create'}</button>
        {applicationUsers.map((user) => {
          const userSelected = groupChannelMembers.some((member) => member === user.userId);
            return <div
              key={user.userId}
              className={`member-item ${userSelected ? 'member-selected' : ''}`}
              onClick={() => addToChannelMembersList(user.userId)}>
              <ProfileImage user={user} />
              <div className="member-item-name">{user.nickname}</div>
            </div>
        })}
      </div>
    </div >;
  }
  return null;
}

const CreateUserForm = ({
  setupUser,
  settingUpUser,
  userNameInputValue,
  userIdInputValue,
  onUserNameInputChange,
  onUserIdInputChange
}) => {
  if (settingUpUser) {
    return <div className="overlay">
      <div className="overlay-content">
        <div>User ID</div>

        <input
          onChange={onUserIdInputChange}
          className="form-input"
          type="text" value={userIdInputValue} />

        <div>User Nickname</div>
        <input
          onChange={onUserNameInputChange}
          className="form-input"
          type="text" value={userNameInputValue} />

        <button
          className="user-submit-button"
          onClick={setupUser}>Connect</button>
      </div>
    </div>
  } else {
    return null;
  }
}

// Helpful functions that call Sendbird
const loadChannels = async () => {
  try {
    const groupChannelQuery = sb.groupChannel.createMyGroupChannelListQuery({ limit: 30, includeEmpty: true });
    const channels = await groupChannelQuery.next();
    return [channels, null];
  } catch (error) {
    return [null, error];
  }
}

const joinChannel = async (channel) => {
  try {
    const messageListParams = new MessageListParams();
    messageListParams.nextResultSize = 20;
    const messages = await channel.getMessagesByTimestamp(0, messageListParams);
    return [messages, null];
  } catch (error) {
    return [null, error];
  }
}

const inviteUsersToChannel = async (channel, userIds) => {
  await channel.inviteWithUserIds(userIds);
}

const createChannel = async (channelName, userIdsToInvite) => {
  try {
    const groupChannelParams = new GroupChannelCreateParams();
    groupChannelParams.addUserIds(userIdsToInvite);
    groupChannelParams.name = channelName;
    groupChannelParams.operatorUserIds = userIdsToInvite;
    const groupChannel = await sb.groupChannel.createChannel(groupChannelParams);
    return [groupChannel, null];
  } catch (error) {
    return [null, error];
  }
}

const deleteChannel = async (channelUrl) => {
  try {
    const channel = await sb.groupChannel.getChannel(channelUrl);
    await channel.delete();
    return [channel, null];
  } catch (error) {
    return [null, error];
  }
}

const deleteMessage = async (currentlyJoinedChannel, messageToDelete) => {
  await currentlyJoinedChannel.deleteMessage(messageToDelete);
}

const getAllApplicationUsers = async () => {
  try {
    const userQuery = sb.createApplicationUserListQuery({ limit: 100 });
    const users = await userQuery.next();
    return [users, null];
  } catch (error) {
    return [null, error];
  }
}

const getParamsForThreading = async (parentsMessage, currentlyJoinedChannel) => {

  const params = new MessageRetrievalParams({
    messageId: parentsMessage.messageId,
    channelType: "group", // Acceptable values are open and group.
    channelUrl: currentlyJoinedChannel.url,
  });

  const paramsThreadedMessageListParams = new ThreadedMessageListParams({
    prevResultSize: 10,
    nextResultSize: 10,
    isInclusive: true,
    reverse: false,
    includeParentMessageInfo: false,
  })

  try {
    const { threadedMessages } = await parentsMessage.getThreadedMessagesByTimestamp(30, paramsThreadedMessageListParams);

    return {params: params, threadedMessages: threadedMessages}
  } catch (e) {
    console.log('Error:', e);
  }
}

export default GroupChannelMessageThreading;