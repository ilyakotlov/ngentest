const path = require('path');
const {getImportLib, reIndent} = require('./lib/util.js');
const windowObjects = require('./lib/window-objects.js');

module.exports = function getDirectiveData(tsParsed, filePath, angularType) {
  const componentPath = './' + path.basename(filePath).replace(/.ts$/,'');
  const componentFixturesPath = './__fixtures__/' + componentPath.split('/').pop().replace(/\.component$/, '.fixture')

  let result = {
    componentPath: filePath.replace(/.ts$/,'').replace(/^apps\/backoffice\/src/, '@backoffice'),
    className: tsParsed.name,
    imports: {
      [componentPath]: [tsParsed.name], // the component itself,
      [componentFixturesPath]: ['*'] // fixtures for the component
    },
    constants: {},
    variables: {},
    inputs: {attributes: [], properties: []},
    outputs: {attributes: [], properties: []},
    providers: {},
    mocks: {},
    functionTests: {},
    testbedImports: {}
  };

  //
  // Iterate properties
  // . if @Input, build input attributes and input properties
  // . if @Outpu, build output attributes and output properties
  //
  for (var key in tsParsed.properties) {
    const prop = tsParsed.properties[key];
    if (prop.body.match(/@Input\(/)) {
      const attrName = (prop.body.match(/@Input\(['"](.*?)['"]\)/) || [])[1];
      result.inputs.attributes.push(`[${attrName || key}]="${key}"`);
      result.inputs.properties.push(`${key}: ${prop.type};`);
    } else if (prop.body.match(/@Output\(/)) {
      const attrName = (prop.body.match(/@Output\(['"](.*?)['"]\)/) || [])[1];
      const funcName = `on${key.replace(/^[a-z]/, x => x.toUpperCase())}`;
      result.outputs.attributes.push(`(${attrName || key})="${funcName}($event)"`);
      result.outputs.properties.push(`${funcName}(event): void { /* */ }`);
    }
  }

  //
  // Iterate constructor parameters
  //  . if this pattern, `@Inject(PLATFORM_ID)`,
  //    . add Inject, PLATFORM_ID to result.imports
  //    . create provider with value
  //  . if type is found at tsParsed.imports, 
  //    . add the type to result.imports
  //    . if type is ElementRef,
  //      . create a mock class
  //      . add to result.providers with mock
  //    . if source starts from './', which is a user-defined injectable
  //      . create a mock class
  //      . add te result.providers with mock 
  //    . otherwise, add to result.providers
  //

  (tsParsed.constructor.parameters || []).forEach(param => { // name, type, body
    // handle @Inject(XXXXXXXXX)
    const importLib = getImportLib(tsParsed.imports, param.type);
    const matches = param.body.match(/@Inject\(([A-Z0-9_]+)\)/);
  
    if (matches) {
      let className = matches[1]
      let lib1 = getImportLib(tsParsed.imports, 'Inject');
      let lib2 = getImportLib(tsParsed.imports, className);
      result.imports[lib1] = result.imports[lib1] || [];
      result.imports[lib2] = result.imports[lib2] || [];
      result.imports[lib1].push('Inject');
      result.imports[lib2].push(className);
      
      result.providers[matches[1]] = `{ provide: ${className},useValue: 'browser' }`;
    } 
    
    switch (param.type) {
      case 'ElementRef':
        result.imports[importLib] = result.imports[importLib] || [];
        result.imports[importLib].push(param.type);
        result.mocks[param.type] = reIndent(`
          @Injectable()
          class Mock${param.type} {
            // constructor() { super(undefined); }
            nativeElement = {}
          }`);
        result.providers[param.type] = `{provide: ${param.type}, useClass: Mock${param.type}}`;
        break;
      case 'ActivatedRoute':
      case 'Router':
        result.imports[importLib] = result.imports[importLib] || [];
        result.imports[importLib].push(param.type);
        result.imports['@frontend/test-helper/activated-route-mock'] = ['MockActivatedRoute'];
        result.providers[param.type] = `{ provide: ${param.type}, useFactory: () => new MockActivatedRoute() }`;
        break;
      case 'Utils':
        result.constants['MockUtilities'] = 'mock<Utils>(Utils)';
        result.providers['Utils'] = '{ provide: Utils, useFactory: () => MockUtilities }';
        break;
      case 'NgRedux<State>':
        result.imports['@angular-redux/store'] = ['NgRedux'];
        result.imports['@angular-redux/store/testing'] = ['MockNgRedux'];
        result.constants['stubRedux'] = 'MockNgRedux.getInstance()';
        result.providers['NgRedux'] = '{ provide: NgRedux, useFactory: () => stubRedux }';
        break;
      default:
        result.imports[importLib] = result.imports[importLib] || [];
        result.imports[importLib].push(param.type);
        result.variables[`mock${param.type}`] = `mock<${param.type}>(${param.type})`;
        result.providers[param.type] = `{ provide: ${param.type}, useFactory: () => instance(mock${param.type}) }`;
        break;
    }
  });

  //
  // Iterate properties
  //  . if property type is a windows type
  //    then create mock with (windows<any>) with the value of `jest.fn()``
  //
  for (var key in tsParsed.properties) {
    let prop = tsParsed.properties[key];
    let basicTypes = ['Object', 'boolean', 'number', 'string', 'Array', 'any', 'void', 'null', 'undefined', 'never'];
    let importLib = getImportLib(tsParsed.imports, prop.type);
    if (importLib || basicTypes.includes(prop.type)) {
      continue;
    } else if (windowObjects.includes(prop.type)) {
      result.mocks[prop.type] = reIndent(`
        (<any>window).${prop.type} = jest.fn();
      `);
    }
  }

  //
  // Iterate methods
  //  . Javascript to call the function with parameter;
  //
  for (var key in tsParsed.methods) {
    let method = tsParsed.methods[key];
    let parameters = method.parameters.map(el => el.name).join(', ');
    let js = `${angularType.toLowerCase()}.${key}(${parameters})`;
    (method.type !== 'void') && (js = `const result = ${js}`); 
    const testName = `should run #${key}()`;
    result.functionTests[testName] = reIndent(`
      it('${testName}', async () => {
        // ${js};
      });
    `, '  ');
  }

  return result;
}
