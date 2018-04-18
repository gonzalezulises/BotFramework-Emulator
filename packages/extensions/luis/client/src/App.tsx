import * as React from 'react';
import { Component } from 'react';
import { css } from 'glamor';
import { Splitter, Colors } from '@bfemulator/ui-react';
import { IInspectorHost } from '@bfemulator/sdk-client';
import Editor from './Controls/Editor';
import { ControlBar, ButtonSelected } from './Controls/ControlBar';
import ReactJson from 'react-json-view';
import { RecognizerResult } from './Models/RecognizerResults';
import { LuisAppInfo } from './Models/LuisAppInfo';
import AppStateAdapter from './AppStateAdapter';
import LuisClient from './Luis/Client';
import { AppInfo } from './Luis/AppInfo';
import { IntentInfo } from './Luis/IntentInfo';
import { LuisTraceInfo } from './Models/LuisTraceInfo';
import Header from './Controls/Header';
import MockState from './Data/MockData';
import { IActivity, ServiceType, IBotConfig } from '@bfemulator/sdk-shared';
import { ILuisService } from '@bfemulator/sdk-shared';

let $host: IInspectorHost = (window as any).host;
const LuisApiBasePath = 'https://westus.api.cognitive.microsoft.com/luis/api/v2.0';
const TrainAccessoryId = 'train';
const PublichAccessoryId = 'publish';
const AccessoryDefaultState = 'default';
const AccessoryWorkingState = 'working';

let persistentStateKey = Symbol('persistentState').toString();

// TODO: Get these from @bfemulator/react-ui once they're available
css.global('html, body, #root', {
  backgroundColor: Colors.APP_BACKGROUND_DARK,
  cursor: 'default',
  fontSize: '13px',
  height: '100%',
  margin: 0,
  minHeight: '100%',
  overflow: 'hidden',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  width: '622px'
});

css.global('div', {
  boxSizing: 'border-box',
});

css.global('::-webkit-scrollbar', {
  width: '10px',
  height: '10px',
});

css.global('::-webkit-scrollbar-track', {
  background: Colors.SCROLLBAR_TRACK_BACKGROUND_DARK,
});

css.global('::-webkit-scrollbar-thumb', {
  background: Colors.SCROLLBAR_THUMB_BACKGROUND_DARK,
});

let appCss = {
  backgroundColor: Colors.APP_BACKGROUND_DARK,
  height: '100%',
  fontFamily: 'Segoe UI, sans-serif',
  fontSize: '12px',
  padding: '5px'
};

let jsonViewerCss = {
  overflowY: 'auto',
  paddingTop: '10px'
};

jsonViewerCss = Object.assign({}, appCss, jsonViewerCss);

const APP_CSS = css(appCss);

interface AppState {
  traceInfo: LuisTraceInfo;
  appInfo: AppInfo;
  intentInfo: IntentInfo[];
  persistentState: { [key: string]: PersistentAppState };
  controlBarButtonSelected: ButtonSelected;
  authoringKey: string;
  id: string;
}

interface PersistentAppState {
  pendingTrain: boolean;
  pendingPublish: boolean;
}

class App extends Component<any, AppState> {

  luisclient: LuisClient;

  static getLuisAuthoringKey(bot: IBotConfig): string {
    if (!bot || !bot.services) {
      return '';
    }
    let luisService = bot.services.find(s => s.type === ServiceType.Luis) as ILuisService;
    if (!luisService) {
      return '';
    }
    return luisService.authoringKey;
  }

  setControlButtonSelected = (buttonSelected: ButtonSelected): void => {
    this.setState({
      controlBarButtonSelected: buttonSelected
    });
  }
 
  constructor(props: any, context: any) {
    super(props, context);
    this.state = {
      traceInfo: {
        luisModel: {
          ModelID: ''
        },
        recognizerResult: {},
        luisOptions: {}
      } as LuisTraceInfo,
      appInfo: {} as AppInfo,
      intentInfo: [] as IntentInfo[],
      persistentState: this.loadAppPersistentState(),
      controlBarButtonSelected: ButtonSelected.RawResponse,
      id: '',
      authoringKey: App.getLuisAuthoringKey($host.bot)
    };
    this.reassignIntent = this.reassignIntent.bind(this);
  }

  componentWillMount() {
    // Attach a handler to listen on inspect events
    if (!this.runningDetached()) {
      $host.on('inspect', async (obj: any) => {
        let appState = new AppStateAdapter(obj);
        appState.persistentState = this.loadAppPersistentState();
        appState.authoringKey = App.getLuisAuthoringKey($host.bot);
        this.setState(appState);
        await this.populateLuisInfo();
        $host.setInspectorTitle(this.state.appInfo.isDispatchApp ? 'Dispatch' : 'LUIS');
        $host.setAccessoryState(TrainAccessoryId, AccessoryDefaultState);
        $host.setAccessoryState(PublichAccessoryId, AccessoryDefaultState);
        $host.enableAccessory(TrainAccessoryId, this.state.persistentState[this.state.id] && 
                                                this.state.persistentState[this.state.id].pendingTrain);
        $host.enableAccessory(PublichAccessoryId, this.state.persistentState[this.state.id] && 
                                                  this.state.persistentState[this.state.id].pendingPublish);
      });
      
      $host.on('accessory-click', async (id: string) => {
        switch (id) {
          case TrainAccessoryId:
            await this.train();
            break;
          case PublichAccessoryId:
            await this.publish();
            break;
          default:
            break;
        }
      });

      $host.on('bot-updated', (bot: IBotConfig) => {
        this.setState({
          authoringKey: App.getLuisAuthoringKey(bot)
        });
      });
    } else {
      this.setState(new MockState());
    }
  }

  render() {
    return (
      <div {...APP_CSS}>
        <Header 
          appId={this.state.traceInfo.luisModel.ModelID}
          appName={this.state.appInfo.name}
          slot={this.state.traceInfo.luisOptions.Staging ? 'Staging' : 'Production'} 
          version={this.state.appInfo.activeVersion}
        />
        <ControlBar 
          setButtonSelected={this.setControlButtonSelected} 
          buttonSelected={this.state.controlBarButtonSelected} 
        />
        <Splitter orientation={'vertical'} primaryPaneIndex={0} minSizes={{ 0: 306, 1: 306 }} initialSizes={{ 0: 306 }}>
          <ReactJson 
            name={this.state.controlBarButtonSelected === ButtonSelected.RecognizerResult ? 
                  'recognizerResult' : 
                  'luisResponse' }
            src={this.state.controlBarButtonSelected === ButtonSelected.RecognizerResult ? 
                this.state.traceInfo.recognizerResult : 
                this.state.traceInfo.luisResult} 
            theme="monokai" 
            style={jsonViewerCss} 
          />
          <Editor 
            recognizerResult={this.state.traceInfo.recognizerResult} 
            intentInfo={this.state.intentInfo} 
            intentReassigner={this.reassignIntent} 
            appInfo={this.state.appInfo}
            traceId={this.state.id}
          />
        </Splitter>
      </div>
    );
  }

  runningDetached() {
    return !$host;
  }

  async populateLuisInfo() {
    if (this.state.traceInfo != null) {
      this.luisclient = new LuisClient({
        appId: this.state.traceInfo.luisModel.ModelID,
        baseUri: LuisApiBasePath,
        key: this.state.authoringKey
      } as LuisAppInfo);

      let appInfo = await this.luisclient.getApplicationInfo();
      this.setState({
        appInfo: appInfo
      });
      let intents = await this.luisclient.getApplicationIntents(appInfo);
      this.setState({
        intentInfo: intents
      });
    }
  }

  async reassignIntent(newIntent: string, needsRetrain: boolean): Promise<void> {
    await this.luisclient.reassignIntent(
      this.state.appInfo, 
      this.state.traceInfo.luisResult, 
      newIntent);
    
    this.setAppPersistentState({
      pendingTrain: needsRetrain,
      pendingPublish: false
    });
  }

  async train(): Promise<void> {
    $host.setAccessoryState(TrainAccessoryId, AccessoryWorkingState);
    try {
      await this.luisclient.train(this.state.appInfo);
    } finally {
      $host.setAccessoryState(TrainAccessoryId, AccessoryDefaultState);
    }
    this.setAppPersistentState({
      pendingTrain: false,
      pendingPublish: true
    });
  }

  async publish(): Promise<void> {
    $host.setAccessoryState(PublichAccessoryId, AccessoryWorkingState);
    try {
      await this.luisclient.publish(this.state.appInfo, this.state.traceInfo.luisOptions.Staging || false);
    } finally {
      $host.setAccessoryState(PublichAccessoryId, AccessoryDefaultState);
    }
    this.setAppPersistentState({
        pendingPublish: false,
        pendingTrain: false
    });
  }

  private setAppPersistentState(persistentState: PersistentAppState) {
    this.state.persistentState[this.state.id] = persistentState;
    this.setState({persistentState: this.state.persistentState});
    localStorage.setItem(persistentStateKey, JSON.stringify(this.state.persistentState));
    $host.enableAccessory(TrainAccessoryId, persistentState.pendingTrain);
    $host.enableAccessory(PublichAccessoryId, persistentState.pendingPublish);
  }

  private loadAppPersistentState(): {[key: string]: PersistentAppState} {
    let persisted = localStorage.getItem(persistentStateKey);
    if (persisted !== null) {
      return JSON.parse(persisted);
    }
    return { '': {
      pendingTrain: false,
      pendingPublish: false
    }
   };
  }
}

export { App, AppState, PersistentAppState };