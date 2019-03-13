/**
 * @license Copyright (c) 2003-2019, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/**
 * @module mention/mentionui
 */

import Plugin from '@ckeditor/ckeditor5-core/src/plugin';
import mix from '@ckeditor/ckeditor5-utils/src/mix';
import EmitterMixin from '@ckeditor/ckeditor5-utils/src/emittermixin';
import View from '@ckeditor/ckeditor5-ui/src/view';
import ListView from '@ckeditor/ckeditor5-ui/src/list/listview';
import ListItemView from '@ckeditor/ckeditor5-ui/src/list/listitemview';
import ButtonView from '@ckeditor/ckeditor5-ui/src/button/buttonview';
import Collection from '@ckeditor/ckeditor5-utils/src/collection';
import BalloonPanelView from '@ckeditor/ckeditor5-ui/src/panel/balloon/balloonpanelview';
import Rect from '@ckeditor/ckeditor5-utils/src/dom/rect';

/**
 * The mention ui feature.
 *
 * @extends module:core/plugin~Plugin
 */
export default class MentionUI extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'MentionUI';
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;

		const locale = editor.locale;

		this._panel = new BalloonPanelView( locale );
		this._panel.withArrow = false;
		this._panel.render();

		this.editor.ui.view.body.add( this._panel );

		this._mentions = new MentionsView( locale );

		const items = new Collection();

		this._panel.content.add( this._mentions );

		this._mentions.listView.items.bindTo( items ).using( item => {
			const { label } = item;
			const listItemView = new ListItemView( locale );
			const buttonView = new ButtonView( locale );

			buttonView.label = label;
			buttonView.withText = true;
			buttonView.item = item;

			listItemView.children.add( buttonView );

			buttonView.delegate( 'execute' ).to( this._mentions );

			return listItemView;
		} );

		const regExp = / (@)([\w]*?)$/;

		const watcher = new TextWatcher( editor, testCallback );

		this._mentions.on( 'execute', evt => {
			const label = evt.source.label;

			const text = watcher.last;

			if ( !text ) {
				return;
			}

			const matched = getMatchedText( text );

			editor.model.change( writer => {
				const end = writer.createPositionAt( editor.model.document.selection.focus );
				const start = end.getShiftedBy( -( 1 + matched.feedText.length ) );

				const range = writer.createRange( start, end );

				writer.setAttribute( 'mention', label, range );
				writer.remove( range );

				writer.insertText( `@${ label }`, { mention: 'label' }, start );
				writer.insertText( ' ', editor.model.document.selection.focus );
			} );
		} );

		function testCallback( text ) {
			return regExp.test( text );
		}

		function getMatchedText( text ) {
			const match = text.match( regExp );

			const marker = match[ 1 ];
			const feedText = match[ 2 ];

			return { marker, feedText };
		}

		watcher.on( 'matched', ( evt, data ) => {
			const text = data.text;

			const matched = getMatchedText( text );

			items.clear();

			const feed = [ 'Jodator', 'Foo', 'Bar' ];

			const strings = feed.filter( item => {
				return item.toLowerCase().startsWith( matched.feedText.toLowerCase() );
			} );

			for ( const item of strings ) {
				items.add( { label: item } );
			}

			if ( items.length ) {
				this._showForm();
			} else {
				this._hideForm();
			}
		} );

		watcher.on( 'unmatched', () => {
			this._hideForm();
		} );
	}

	_showForm() {
		if ( this._isVisible ) {
			// return;
		}

		// Pin the panel to an element with the "target" id DOM.
		this._panel.pin( this._getBalloonPositionData() );

		this._panel.show();
	}

	// TODO copied from balloontoolbar
	_getBalloonPositionData() {
		const editor = this.editor;
		const view = editor.editing.view;
		const viewDocument = view.document;
		const viewSelection = viewDocument.selection;

		return {
			// Because the target for BalloonPanelView is a Rect (not DOMRange), it's geometry will stay fixed
			// as the window scrolls. To let the BalloonPanelView follow such Rect, is must be continuously
			// computed and hence, the target is defined as a function instead of a static value.
			// https://github.com/ckeditor/ckeditor5-ui/issues/195
			target: () => {
				const range = viewSelection.getLastRange();
				const rangeRects = Rect.getDomRangeRects( view.domConverter.viewRangeToDom( range ) );

				// Select the proper range rect depending on the direction of the selection.
				if ( rangeRects.length > 1 && rangeRects[ rangeRects.length - 1 ].width === 0 ) {
					rangeRects.pop();
				}

				return rangeRects[ rangeRects.length - 1 ];
			},
			positions: getBalloonPositions()
		};
	}

	_hideForm() {
		this._panel.hide();
	}
}

// Returns whole text from parent element by adding all data from text nodes together.
//
// @private
// @param {module:engine/model/element~Element} element
// @returns {String}
function getText( element ) {
	return Array.from( element.getChildren() ).reduce( ( a, b ) => a + b.data, '' );
}

class TextWatcher {
	constructor( editor, callbackOrRegex ) {
		this.editor = editor;
		this.testCallback = callbackOrRegex;

		this.hasMatch = false;

		this._startListening();
	}

	get last() {
		return this._getText();
	}

	_startListening() {
		const editor = this.editor;

		editor.model.document.on( 'change', ( evt, batch ) => {
			if ( batch.type == 'transparent' ) {
				return;
			}

			const changes = Array.from( editor.model.document.differ.getChanges() );
			const entry = changes[ 0 ];

			// Typing is represented by only a single change.
			if ( changes.length != 1 || entry.name != '$text' || entry.length != 1 ) {
				return undefined;
			}

			const text = this._getText();

			const textHasMatch = this.testCallback( text );

			if ( !textHasMatch && this.hasMatch ) {
				this.fire( 'unmatched' );
			}

			this.hasMatch = textHasMatch;

			if ( textHasMatch ) {
				this.fire( 'matched', { text } );
			}
		} );
	}

	_getText() {
		const editor = this.editor;
		const selection = editor.model.document.selection;

		// Do nothing if selection is not collapsed.
		if ( !selection.isCollapsed ) {
			return undefined;
		}

		const block = selection.focus.parent;

		return getText( block ).slice( 0, selection.focus.offset );
	}
}

mix( TextWatcher, EmitterMixin );

class MentionsView extends View {
	constructor( locale ) {
		super( locale );

		this.listView = new ListView( locale );

		this.setTemplate( {
			tag: 'div',

			attributes: {
				class: [
					'ck',
					'ck-mention'
				],

				tabindex: '-1'
			},

			children: [
				this.listView
			]
		} );
	}
}

function getBalloonPositions() {
	const defaultPositions = BalloonPanelView.defaultPositions;

	return [
		defaultPositions.northArrowSouthWest,
		defaultPositions.southArrowNorthWest
	];
}
